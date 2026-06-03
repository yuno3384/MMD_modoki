import type { ScenePlugin } from "./plugin-types";
import { pluginUiRegistry } from "./ui-registry";
import {
    buildHighlightPlanForCandidate,
    MmeFallbackController,
    type MmeFallbackApplyTransaction,
    type MmeFallbackApplyAvailability,
    type MmeFallbackControllerState,
    type MmeFallbackHighlightPlan,
    type MmeFallbackPreviewPlanItem,
    type MmeFallbackTargetCandidate,
} from "./mme-fallback-controller";
import {
    createMmeManifest,
    getMmeFileKind,
    normalizeMmePath,
    type MMEManifest,
    type MmeCompatFileEntry,
} from "./mme-compat-manifest";
import type { MaterialEffectTarget } from "./material-targets";

export type MmeFileRegistrationResult = {
    ok: boolean;
    manifest: MMEManifest | null;
    reason?: "unsupported-extension";
};

export type MmeFileRemovalResult = {
    ok: boolean;
    manifest: MMEManifest | null;
    reason?: "file-not-registered";
};

type MmePickerFileLike = {
    readonly name: string;
    readonly webkitRelativePath?: string;
    text(): Promise<string>;
};

export type MmePickerRegistrationSummary = {
    readonly acceptedCount: number;
    readonly rejectedCount: number;
    readonly warnings: readonly string[];
};

export type MmeCandidateFilterKind = "all" | "model" | "accessory";
export type MmeCandidateFilterPreset = "all" | "basicToon" | "textureToon" | "katameLike" | "emissiveLite" | "unsupported" | "none";
export type MmeCandidateFilterStatus = "all" | "global-effect-candidate" | "unsupported" | "unmatched";
export type MmeCandidateSortKey = "ownerName" | "materialName" | "preset" | "confidenceDesc";

export type MmeCandidateViewOptions = {
    readonly kind: MmeCandidateFilterKind;
    readonly preset: MmeCandidateFilterPreset;
    readonly status: MmeCandidateFilterStatus;
    readonly search: string;
    readonly sortKey: MmeCandidateSortKey;
};

export type MmeCandidateDetailState = {
    readonly selectedCandidateId: string | null;
    readonly selectedCandidate: MmeFallbackTargetCandidate | null;
};

export type MmeCandidateHighlightDetailState = MmeCandidateDetailState & {
    readonly highlightPlan: MmeFallbackHighlightPlan;
};

export type MmeCompatApplyButtonState = {
    readonly enabled: boolean;
    readonly label: string;
};

export type MmeCompatRevertButtonState = {
    readonly enabled: boolean;
    readonly label: string;
};

export type MmeCompatHighlightButtonState = {
    readonly enabled: boolean;
    readonly label: string;
};

export type MmeCompatApplyPlanRow = {
    readonly targetId: string;
    readonly ownerName: string | null;
    readonly meshName: string | null;
    readonly materialName: string | null;
    readonly originalMaterialAvailability: "available" | "unavailable";
    readonly plannedFallbackPreset: string;
    readonly matchingPolicy: string | null;
    readonly validationReason: string | null;
};

export type InternalMmeCompatManifestPlugin = ScenePlugin & {
    getManifest(): MMEManifest | null;
    getCurrentMmeManifest(): MMEManifest | null;
    discoverManifest(rootFile: string, files: readonly MmeCompatFileEntry[]): MMEManifest;
    registerMmeFile(file: MmeCompatFileEntry): MmeFileRegistrationResult;
    removeMmeFile(path: string): MmeFileRemovalResult;
    clearManifest(): void;
    clearMmeManifest(): void;
};

type InternalMmeCompatManifestPluginOptions = {
    getSceneMaterialTargets?: () => readonly MaterialEffectTarget[];
};

/**
 * Internal MME compatibility skeleton.
 *
 * Current role:
 * - discover legacy effect bundle metadata
 * - expose a debug summary panel
 * - avoid shader parsing/rendering until later steps
 *
 * Intended future use:
 * - asset loading paths will call discoverManifest(...) when an accessory or
 *   effect bundle is selected/imported
 */
export function createInternalMmeCompatManifestPlugin(
    options: InternalMmeCompatManifestPluginOptions = {},
): InternalMmeCompatManifestPlugin {
    let manifest: MMEManifest | null = null;
    const registeredFiles = new Map<string, MmeCompatFileEntry>();
    const mountedContainers = new Set<HTMLElement>();
    const fallbackController = new MmeFallbackController();
    let lastPickerWarnings: string[] = [];
    let lastPickerAcceptedCount = 0;
    let selectedCandidateId: string | null = null;
    let lastApplyActionMessage: string | null = null;
    let lastHighlightActionMessage: string | null = null;
    let candidateViewOptions: MmeCandidateViewOptions = {
        kind: "all",
        preset: "all",
        status: "all",
        search: "",
        sortKey: "confidenceDesc",
    };

    const resetInteractiveManifestState = (): void => {
        selectedCandidateId = null;
        lastApplyActionMessage = null;
        lastHighlightActionMessage = null;
        fallbackController.setEnabled(false);
        fallbackController.setExperimentalApplyEnabled(false);
    };

    const rebuildManifestFromRegisteredFiles = (): MMEManifest | null => {
        const selectedRootFile = selectRegisteredRootFile(Array.from(registeredFiles.values()));
        manifest = selectedRootFile
            ? createMmeManifest(selectedRootFile, Array.from(registeredFiles.values()))
            : null;
        lastPickerAcceptedCount = registeredFiles.size;
        return manifest;
    };

    const clearCurrentManifest = (): void => {
        manifest = null;
        registeredFiles.clear();
        lastPickerWarnings = [];
        lastPickerAcceptedCount = 0;
        resetInteractiveManifestState();
        rerenderPanels();
    };

    const handleSelectedMmeFiles = async (files: readonly MmePickerFileLike[]): Promise<void> => {
        const summary = await registerPickedMmeFiles({
            files,
            registerMmeFile: (file) => pluginApi.registerMmeFile(file),
        });
        lastPickerAcceptedCount = registeredFiles.size;
        lastPickerWarnings = [...summary.warnings];
        rerenderPanels();
    };

    const renderPanel = (container: HTMLElement): void => {
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.minHeight = "0";
        container.style.maxHeight = "min(60vh, 520px)";
        container.style.overflow = "hidden";
        container.replaceChildren();

        const summary = document.createElement("div");
        summary.style.display = "grid";
        summary.style.gap = "6px";
        summary.style.fontSize = "12px";
        summary.style.flex = "1 1 auto";
        summary.style.minHeight = "0";
        summary.style.overflowY = "auto";
        summary.style.overflowX = "hidden";
        summary.style.paddingRight = "4px";

        const pickerSection = document.createElement("div");
        pickerSection.style.display = "grid";
        pickerSection.style.gap = "6px";
        pickerSection.style.marginBottom = "8px";

        const pickerLabel = document.createElement("div");
        pickerLabel.textContent = "MME file registration (.x, .fx, .fxsub, .conf)";
        pickerLabel.style.fontWeight = "600";
        pickerSection.appendChild(pickerLabel);

        const pickerInput = document.createElement("input");
        pickerInput.type = "file";
        pickerInput.accept = ".x,.fx,.fxsub,.conf";
        pickerInput.multiple = true;
        pickerInput.addEventListener("change", () => {
            const selectedFiles = Array.from(pickerInput.files ?? []);
            void handleSelectedMmeFiles(selectedFiles as readonly MmePickerFileLike[]);
            pickerInput.value = "";
        });
        pickerSection.appendChild(pickerInput);

        appendSummaryRow(pickerSection, "Registered Files", String(lastPickerAcceptedCount));
        if (lastPickerWarnings.length > 0) {
            const warningBlock = document.createElement("pre");
            warningBlock.textContent = lastPickerWarnings.join("\n");
            warningBlock.style.margin = "0";
            warningBlock.style.padding = "8px";
            warningBlock.style.maxHeight = "100px";
            warningBlock.style.overflow = "auto";
            warningBlock.style.whiteSpace = "pre-wrap";
            warningBlock.style.background = "rgba(120, 53, 15, 0.18)";
            warningBlock.style.borderRadius = "8px";
            pickerSection.appendChild(warningBlock);
        }

        if (registeredFiles.size > 0) {
            const registeredList = document.createElement("div");
            registeredList.style.display = "grid";
            registeredList.style.gap = "6px";

            const registeredListLabel = document.createElement("div");
            registeredListLabel.textContent = "Registered file entries";
            registeredListLabel.style.fontWeight = "600";
            registeredList.appendChild(registeredListLabel);

            for (const registeredFile of registeredFiles.values()) {
                const row = document.createElement("div");
                row.style.display = "grid";
                row.style.gridTemplateColumns = "minmax(0, 1fr) auto";
                row.style.alignItems = "center";
                row.style.gap = "8px";
                row.style.padding = "8px";
                row.style.borderRadius = "8px";
                row.style.background = "rgba(255, 255, 255, 0.04)";

                const label = document.createElement("div");
                label.textContent = registeredFile.path;
                label.style.wordBreak = "break-all";
                label.style.fontSize = "12px";
                row.appendChild(label);

                const removeButton = document.createElement("button");
                removeButton.type = "button";
                removeButton.textContent = "Remove";
                removeButton.style.whiteSpace = "nowrap";
                removeButton.addEventListener("click", () => {
                    pluginApi.removeMmeFile(registeredFile.path);
                });
                row.appendChild(removeButton);

                registeredList.appendChild(row);
            }

            pickerSection.appendChild(registeredList);
        }

        summary.appendChild(pickerSection);

        if (!manifest) {
            const empty = document.createElement("div");
            empty.textContent = "No MME manifest loaded yet.";
            empty.style.opacity = "0.8";
            summary.appendChild(empty);

            const note = document.createElement("div");
            note.textContent = "Future file-loading paths can call registerMmeFile(...) or discoverManifest(...) for .x/.fx bundles.";
            note.style.opacity = "0.65";
            summary.appendChild(note);

            container.appendChild(summary);
            return;
        }

        appendSummaryRow(summary, "Root", `${manifest.rootFile} (${manifest.rootKind})`);
        appendSummaryRow(summary, "FX", String(manifest.discoveredFxFiles.length));
        appendSummaryRow(summary, "FXSUB", String(manifest.discoveredFxSubFiles.length));
        appendSummaryRow(summary, "CONF", String(manifest.discoveredConfFiles.length));
        appendSummaryRow(summary, "Parsed FX", String(Object.keys(manifest.parsedEffects).length));
        appendSummaryRow(summary, "Textures", String(manifest.textureCandidates.length));
        appendSummaryRow(summary, "Missing", String(manifest.missingFiles.length));
        appendSummaryRow(summary, "Warnings", String(manifest.warnings.length));

        const controllerState = fallbackController.getState();
        const applyGateStatus = fallbackController.getApplyGateStatus();
        const currentApplyPlan = fallbackController.getApplyPlan();
        const sceneMaterialTargets = options.getSceneMaterialTargets?.() ?? [];
        appendSummaryRow(summary, "Fallback Preview", controllerState.enabled ? "ON" : "OFF");
        appendSummaryRow(summary, "Fallback Mode", controllerState.mode);
        appendSummaryRow(summary, "Preview Targets", String(controllerState.plannedTargets.length));
        appendSummaryRow(summary, "Experimental Apply Gate", applyGateStatus.experimentalApplyEnabled ? "ON" : "OFF");

        const controls = document.createElement("div");
        controls.style.display = "grid";
        controls.style.gridTemplateColumns = "1fr 1fr";
        controls.style.gap = "8px";
        controls.style.marginTop = "8px";

        const previewToggle = document.createElement("label");
        previewToggle.style.display = "flex";
        previewToggle.style.alignItems = "center";
        previewToggle.style.gap = "6px";
        const previewCheckbox = document.createElement("input");
        previewCheckbox.type = "checkbox";
        previewCheckbox.checked = controllerState.enabled;
        previewCheckbox.addEventListener("change", () => {
            if (previewCheckbox.checked) {
                fallbackController.setMode("preview");
                fallbackController.setEnabled(true);
            } else {
                fallbackController.setEnabled(false);
                selectedCandidateId = null;
                lastApplyActionMessage = null;
                lastHighlightActionMessage = null;
            }
            rerenderPanels();
        });
        previewToggle.appendChild(previewCheckbox);
        previewToggle.appendChild(document.createTextNode("Enable Dry-Run Preview (diagnostic only)"));

        const modeSelect = document.createElement("select");
        const previewOption = document.createElement("option");
        previewOption.value = "preview";
        previewOption.textContent = "preview";
        const applyOption = document.createElement("option");
        applyOption.value = "apply";
        applyOption.textContent = "apply (experimental, basicToon only)";
        modeSelect.appendChild(previewOption);
        modeSelect.appendChild(applyOption);
        modeSelect.value = controllerState.mode;
        modeSelect.disabled = !(controllerState.enabled && applyGateStatus.experimentalApplyEnabled);
        modeSelect.addEventListener("change", () => {
            const nextMode = modeSelect.value === "apply" && applyGateStatus.experimentalApplyEnabled
                ? "apply"
                : "preview";
            fallbackController.setMode(nextMode);
            lastApplyActionMessage = null;
            rerenderPanels();
        });

        controls.appendChild(previewToggle);
        controls.appendChild(modeSelect);
        summary.appendChild(controls);

        const experimentalApplyToggle = document.createElement("label");
        experimentalApplyToggle.style.display = "flex";
        experimentalApplyToggle.style.alignItems = "center";
        experimentalApplyToggle.style.gap = "6px";
        experimentalApplyToggle.style.marginTop = "8px";
        const experimentalApplyCheckbox = document.createElement("input");
        experimentalApplyCheckbox.type = "checkbox";
        experimentalApplyCheckbox.checked = applyGateStatus.experimentalApplyEnabled;
        experimentalApplyCheckbox.addEventListener("change", () => {
            fallbackController.setExperimentalApplyEnabled(experimentalApplyCheckbox.checked);
            if (!experimentalApplyCheckbox.checked && fallbackController.getState().mode === "apply") {
                fallbackController.setMode("preview");
            }
            lastApplyActionMessage = null;
            rerenderPanels();
        });
        experimentalApplyToggle.appendChild(experimentalApplyCheckbox);
        experimentalApplyToggle.appendChild(document.createTextNode("Experimental Apply Gate (debug-only, undoable basicToon apply path, explicit opt-in required)"));
        summary.appendChild(experimentalApplyToggle);

        const parsedEffects = Object.values(manifest.parsedEffects);
        if (parsedEffects.length > 0) {
            const previewNotice = document.createElement("div");
            previewNotice.style.marginTop = "8px";
            previewNotice.style.fontSize = "12px";
            previewNotice.style.opacity = "0.75";
            previewNotice.textContent = controllerState.enabled
                ? "Dry-run diagnostic preview. No fallback materials are applied to scene meshes or materials."
                : "Dry-run diagnostic preview is disabled by default. No analysis/planning preview is being computed. Experimental apply is also not implemented.";
            summary.appendChild(previewNotice);

            if (controllerState.enabled) {
                const previewPlan = fallbackController.buildPreviewPlan(buildPreviewInputsFromManifest(manifest), { manifest });
                const targetCandidates = fallbackController.buildTargetCandidateView(sceneMaterialTargets, previewPlan);
                const applyInputs = buildApplyInputsFromTargetsAndPreviewPlan(sceneMaterialTargets, previewPlan, manifest);
                const applyPlan = currentApplyPlan?.status === "applied"
                    ? currentApplyPlan
                    : fallbackController.planApply(applyInputs, { manifest });
                const applyAvailability = fallbackController.getApplyAvailability();
                const revertEnabled = applyPlan?.status === "applied";
                appendSummaryRow(summary, "Apply Status", getMmeCompatApplyStatus(controllerState, applyAvailability));

                const texturePreviewLabel = document.createElement("div");
                texturePreviewLabel.style.marginTop = "8px";
                texturePreviewLabel.style.fontSize = "12px";
                texturePreviewLabel.style.opacity = "0.75";
                texturePreviewLabel.textContent = "Texture Preview Summary. Read-only dry-run diagnostics for parsed effect candidates.";
                summary.appendChild(texturePreviewLabel);
                summary.appendChild(createMmeTexturePreviewSummaryCards(previewPlan));

                const parsedSummary = document.createElement("pre");
                parsedSummary.textContent = JSON.stringify(previewPlan.map((entry) => ({
                    path: entry.effectId,
                    status: entry.analysisStatus,
                    confidence: Number(entry.analysisConfidence.toFixed(2)),
                    fallbackPreset: entry.preset,
                    fallbackConfidence: Number(entry.fallbackConfidence.toFixed(2)),
                    fallbackReasons: entry.fallbackReasons,
                    fallbackMaterialStatus: entry.factoryStatus,
                    mappedFields: entry.mappedFields,
                    textureCandidates: summarizeMappedTextureCandidates(entry.mappedFields),
                    unsupportedFeatures: entry.blockedByUnsupportedFeatures,
                    warnings: entry.warnings,
                })), null, 2);
                parsedSummary.style.margin = "8px 0 0";
                parsedSummary.style.padding = "8px";
                parsedSummary.style.maxHeight = "180px";
                parsedSummary.style.overflow = "auto";
                parsedSummary.style.whiteSpace = "pre-wrap";
                parsedSummary.style.background = "rgba(15, 23, 42, 0.24)";
                parsedSummary.style.borderRadius = "8px";
                summary.appendChild(parsedSummary);

                const candidateNotice = document.createElement("div");
                candidateNotice.style.marginTop = "8px";
                candidateNotice.style.fontSize = "12px";
                candidateNotice.style.opacity = "0.75";
                candidateNotice.textContent = "Scene material target candidates. Read-only dry-run by default; experimental debug apply is limited to undoable basicToon single-global-effect candidates.";
                summary.appendChild(candidateNotice);

                appendSummaryRow(summary, "Apply Plan Targets", String(applyPlan?.targetRecords.length ?? 0));

                const applyPlanNotice = document.createElement("div");
                applyPlanNotice.style.marginTop = "8px";
                applyPlanNotice.style.fontSize = "12px";
                applyPlanNotice.style.opacity = "0.75";
                applyPlanNotice.textContent = "Apply Plan Targets. Read-only pre-apply preview, experimental, and basicToon-only.";
                summary.appendChild(applyPlanNotice);

                const applyPlanRows = buildMmeCompatApplyPlanRows(applyPlan, applyAvailability);
                summary.appendChild(createMmeCompatApplyPlanView(applyPlanRows, applyAvailability));

                const applyControlNotice = document.createElement("div");
                applyControlNotice.style.marginTop = "8px";
                applyControlNotice.style.fontSize = "12px";
                applyControlNotice.style.opacity = "0.75";
                applyControlNotice.textContent = "Experimental debug apply. basicToon only, single-global-effect only, undoable, and routed through controller guards.";
                summary.appendChild(applyControlNotice);

                const applyControls = document.createElement("div");
                applyControls.style.display = "flex";
                applyControls.style.gap = "8px";
                applyControls.style.marginTop = "6px";

                const applyButton = document.createElement("button");
                applyButton.type = "button";
                const applyButtonState = getMmeCompatApplyButtonState(applyAvailability);
                applyButton.disabled = !applyButtonState.enabled;
                applyButton.textContent = applyButtonState.label;
                applyButton.addEventListener("click", () => {
                    const result = fallbackController.applyFallback();
                    lastApplyActionMessage = formatMmeCompatActionResult("Apply", result.status, result.reason, result.warnings);
                    rerenderPanels();
                });
                applyControls.appendChild(applyButton);

                const revertButton = document.createElement("button");
                revertButton.type = "button";
                const revertButtonState = getMmeCompatRevertButtonState(revertEnabled);
                revertButton.disabled = !revertButtonState.enabled;
                revertButton.textContent = revertButtonState.label;
                revertButton.addEventListener("click", () => {
                    const result = fallbackController.revertApply();
                    lastApplyActionMessage = formatMmeCompatActionResult("Revert", result.status, result.reason, result.warnings);
                    rerenderPanels();
                });
                applyControls.appendChild(revertButton);

                summary.appendChild(applyControls);

                if (lastApplyActionMessage) {
                    appendSummaryRow(summary, "Last Apply/Revert Result", lastApplyActionMessage);
                }

                appendSummaryRow(summary, "Scene Target Candidates", String(targetCandidates.length));

                const candidateControls = document.createElement("div");
                candidateControls.style.display = "grid";
                candidateControls.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
                candidateControls.style.gap = "8px";
                candidateControls.style.marginTop = "8px";

                const kindSelect = createSelectControl([
                    { value: "all", label: "Kind: all" },
                    { value: "model", label: "Kind: model" },
                    { value: "accessory", label: "Kind: accessory" },
                ], candidateViewOptions.kind, (value) => {
                    candidateViewOptions = {
                        ...candidateViewOptions,
                        kind: value as MmeCandidateFilterKind,
                    };
                    rerenderPanels();
                });
                const presetSelect = createSelectControl([
                    { value: "all", label: "Preset: all" },
                    { value: "basicToon", label: "Preset: basicToon" },
                    { value: "textureToon", label: "Preset: textureToon" },
                    { value: "katameLike", label: "Preset: katameLike" },
                    { value: "emissiveLite", label: "Preset: emissiveLite" },
                    { value: "unsupported", label: "Preset: unsupported" },
                    { value: "none", label: "Preset: none" },
                ], candidateViewOptions.preset, (value) => {
                    candidateViewOptions = {
                        ...candidateViewOptions,
                        preset: value as MmeCandidateFilterPreset,
                    };
                    rerenderPanels();
                });
                const statusSelect = createSelectControl([
                    { value: "all", label: "Status: all" },
                    { value: "global-effect-candidate", label: "Status: global candidate" },
                    { value: "unsupported", label: "Status: unsupported" },
                    { value: "unmatched", label: "Status: unmatched" },
                ], candidateViewOptions.status, (value) => {
                    candidateViewOptions = {
                        ...candidateViewOptions,
                        status: value as MmeCandidateFilterStatus,
                    };
                    rerenderPanels();
                });
                const sortSelect = createSelectControl([
                    { value: "confidenceDesc", label: "Sort: confidence desc" },
                    { value: "ownerName", label: "Sort: owner name" },
                    { value: "materialName", label: "Sort: material name" },
                    { value: "preset", label: "Sort: preset" },
                ], candidateViewOptions.sortKey, (value) => {
                    candidateViewOptions = {
                        ...candidateViewOptions,
                        sortKey: value as MmeCandidateSortKey,
                    };
                    rerenderPanels();
                });

                candidateControls.appendChild(kindSelect);
                candidateControls.appendChild(presetSelect);
                candidateControls.appendChild(statusSelect);
                candidateControls.appendChild(sortSelect);

                const searchInput = document.createElement("input");
                searchInput.type = "search";
                searchInput.placeholder = "Search owner / mesh / material / effect";
                searchInput.value = candidateViewOptions.search;
                searchInput.addEventListener("input", () => {
                    candidateViewOptions = {
                        ...candidateViewOptions,
                        search: searchInput.value,
                    };
                    rerenderPanels();
                });
                searchInput.style.marginTop = "8px";
                searchInput.style.padding = "6px 8px";
                searchInput.style.borderRadius = "6px";
                searchInput.style.border = "1px solid rgba(148, 163, 184, 0.35)";
                summary.appendChild(candidateControls);
                summary.appendChild(searchInput);

                const visibleCandidates = filterAndSortMmeTargetCandidates(targetCandidates, candidateViewOptions);
                const previousSelectedCandidateId = selectedCandidateId;
                selectedCandidateId = syncSelectedMmeTargetCandidateId(selectedCandidateId, visibleCandidates);
                if (previousSelectedCandidateId !== selectedCandidateId) {
                    fallbackController.clearHighlight();
                    lastHighlightActionMessage = null;
                }
                const selectedCandidateDetail = getSelectedMmeTargetCandidateHighlightDetail(visibleCandidates, selectedCandidateId);
                const highlightAvailability = fallbackController.getHighlightAvailability(selectedCandidateId, sceneMaterialTargets);
                const highlightState = fallbackController.getHighlightState();
                appendSummaryRow(summary, "Visible Candidates", String(visibleCandidates.length));

                if (visibleCandidates.length > 0) {
                    const candidateList = document.createElement("div");
                    candidateList.style.display = "grid";
                    candidateList.style.gap = "6px";
                    candidateList.style.marginTop = "8px";
                    candidateList.style.maxHeight = "180px";
                    candidateList.style.overflow = "auto";

                    for (const candidate of visibleCandidates) {
                        const candidateButton = document.createElement("button");
                        candidateButton.type = "button";
                        candidateButton.style.textAlign = "left";
                        candidateButton.style.padding = "8px";
                        candidateButton.style.borderRadius = "8px";
                        candidateButton.style.border = selectedCandidateId === candidate.targetId
                            ? "1px solid rgba(96, 165, 250, 0.9)"
                            : "1px solid rgba(148, 163, 184, 0.3)";
                        candidateButton.style.background = selectedCandidateId === candidate.targetId
                            ? "rgba(59, 130, 246, 0.16)"
                            : "rgba(15, 23, 42, 0.18)";
                        candidateButton.textContent = [
                            candidate.ownerName ?? "(unknown owner)",
                            candidate.meshName,
                            candidate.materialName,
                            `${candidate.recommendedFallbackPreset} / ${candidate.status}`,
                        ].join(" | ");
                        candidateButton.addEventListener("click", () => {
                            if (selectedCandidateId !== candidate.targetId) {
                                fallbackController.clearHighlight();
                                lastHighlightActionMessage = null;
                            }
                            selectedCandidateId = candidate.targetId;
                            rerenderPanels();
                        });
                        candidateList.appendChild(candidateButton);
                    }

                    summary.appendChild(candidateList);

                    const candidateSummary = document.createElement("pre");
                    candidateSummary.textContent = JSON.stringify(summarizeTargetCandidates(visibleCandidates), null, 2);
                    candidateSummary.style.margin = "8px 0 0";
                    candidateSummary.style.padding = "8px";
                    candidateSummary.style.maxHeight = "180px";
                    candidateSummary.style.overflow = "auto";
                    candidateSummary.style.whiteSpace = "pre-wrap";
                    candidateSummary.style.background = "rgba(15, 23, 42, 0.24)";
                    candidateSummary.style.borderRadius = "8px";
                    summary.appendChild(candidateSummary);

                    const detailLabel = document.createElement("div");
                    detailLabel.style.marginTop = "8px";
                    detailLabel.style.fontSize = "12px";
                    detailLabel.style.opacity = "0.75";
                    detailLabel.textContent = "Selected candidate detail. Read-only dry-run only; not applied.";
                    summary.appendChild(detailLabel);

                    if (selectedCandidateDetail.selectedCandidate) {
                        const detail = document.createElement("pre");
                        detail.textContent = JSON.stringify({
                            targetId: selectedCandidateDetail.selectedCandidate.targetId,
                            ownerName: selectedCandidateDetail.selectedCandidate.ownerName,
                            meshName: selectedCandidateDetail.selectedCandidate.meshName,
                            materialName: selectedCandidateDetail.selectedCandidate.materialName,
                            effectId: selectedCandidateDetail.selectedCandidate.effectId,
                            recommendedPreset: selectedCandidateDetail.selectedCandidate.recommendedFallbackPreset,
                            confidence: Number(selectedCandidateDetail.selectedCandidate.confidence.toFixed(2)),
                            status: selectedCandidateDetail.selectedCandidate.status,
                            matchingPolicy: selectedCandidateDetail.selectedCandidate.matchingPolicy,
                            warnings: selectedCandidateDetail.selectedCandidate.warnings,
                            blockedReasons: selectedCandidateDetail.selectedCandidate.blockedReasons,
                        }, null, 2);
                        detail.style.margin = "8px 0 0";
                        detail.style.padding = "8px";
                        detail.style.maxHeight = "180px";
                        detail.style.overflow = "auto";
                        detail.style.whiteSpace = "pre-wrap";
                        detail.style.background = "rgba(15, 23, 42, 0.24)";
                        detail.style.borderRadius = "8px";
                        summary.appendChild(detail);

                        const highlightLabel = document.createElement("div");
                        highlightLabel.style.marginTop = "8px";
                        highlightLabel.style.fontSize = "12px";
                        highlightLabel.style.opacity = "0.75";
                        highlightLabel.textContent = "Debug highlight plan. Non-mutating only; no material changes, no camera movement, and no apply path is triggered.";
                        summary.appendChild(highlightLabel);

                        const highlightDetail = document.createElement("pre");
                        highlightDetail.textContent = JSON.stringify({
                            selectedCandidateId: selectedCandidateDetail.highlightPlan.selectedCandidateId,
                            targetId: selectedCandidateDetail.highlightPlan.targetId,
                            targetKind: selectedCandidateDetail.highlightPlan.targetKind,
                            ownerName: selectedCandidateDetail.highlightPlan.ownerName,
                            meshName: selectedCandidateDetail.highlightPlan.meshName,
                            materialName: selectedCandidateDetail.highlightPlan.materialName,
                            highlightable: selectedCandidateDetail.highlightPlan.highlightable,
                            reason: selectedCandidateDetail.highlightPlan.reason,
                            warnings: selectedCandidateDetail.highlightPlan.warnings,
                            availability: highlightAvailability,
                            activeHighlightState: highlightState,
                        }, null, 2);
                        highlightDetail.style.margin = "8px 0 0";
                        highlightDetail.style.padding = "8px";
                        highlightDetail.style.maxHeight = "160px";
                        highlightDetail.style.overflow = "auto";
                        highlightDetail.style.whiteSpace = "pre-wrap";
                        highlightDetail.style.background = "rgba(15, 23, 42, 0.24)";
                        highlightDetail.style.borderRadius = "8px";
                        summary.appendChild(highlightDetail);

                        const highlightControls = document.createElement("div");
                        highlightControls.style.display = "flex";
                        highlightControls.style.gap = "8px";
                        highlightControls.style.marginTop = "4px";

                        const highlightButton = document.createElement("button");
                        highlightButton.type = "button";
                        const highlightButtonState = getMmeCompatHighlightButtonState(highlightAvailability);
                        highlightButton.disabled = !highlightButtonState.enabled;
                        highlightButton.textContent = highlightButtonState.label;
                        highlightButton.addEventListener("click", () => {
                            const result = fallbackController.highlightSelectedCandidate(selectedCandidateId, sceneMaterialTargets);
                            lastHighlightActionMessage = formatMmeCompatActionResult("Highlight", result.status, result.reason, result.warnings);
                            rerenderPanels();
                        });
                        highlightControls.appendChild(highlightButton);

                        const clearHighlightButton = document.createElement("button");
                        clearHighlightButton.type = "button";
                        clearHighlightButton.disabled = !highlightState.active;
                        clearHighlightButton.textContent = highlightState.active
                            ? "Clear Highlight"
                            : "Clear Highlight (inactive)";
                        clearHighlightButton.addEventListener("click", () => {
                            const result = fallbackController.clearHighlight();
                            lastHighlightActionMessage = formatMmeCompatActionResult("Highlight", result.status, result.reason, result.warnings);
                            rerenderPanels();
                        });
                        highlightControls.appendChild(clearHighlightButton);

                        summary.appendChild(highlightControls);

                        if (lastHighlightActionMessage) {
                            appendSummaryRow(summary, "Last Highlight Result", lastHighlightActionMessage);
                        }
                    } else {
                        const inactiveDetail = document.createElement("div");
                        inactiveDetail.style.marginTop = "8px";
                        inactiveDetail.style.opacity = "0.75";
                        inactiveDetail.textContent = "No candidate selected.";
                        summary.appendChild(inactiveDetail);
                    }
                } else {
                    fallbackController.clearHighlight();
                    lastHighlightActionMessage = null;
                    selectedCandidateId = null;
                    const emptyCandidates = document.createElement("div");
                    emptyCandidates.textContent = "No scene material target candidates match the current filters.";
                    emptyCandidates.style.marginTop = "8px";
                    emptyCandidates.style.opacity = "0.75";
                    summary.appendChild(emptyCandidates);
                }
            } else {
                appendSummaryRow(summary, "Apply Status", getMmeCompatApplyStatus(controllerState));
            }
        } else {
            appendSummaryRow(summary, "Apply Status", getMmeCompatApplyStatus(controllerState));
        }

        const details = document.createElement("pre");
        details.textContent = JSON.stringify({
            rootFile: manifest.rootFile,
            discoveredFxFiles: manifest.discoveredFxFiles,
            discoveredFxSubFiles: manifest.discoveredFxSubFiles,
            discoveredConfFiles: manifest.discoveredConfFiles,
            parsedEffects: Object.keys(manifest.parsedEffects),
            missingFiles: manifest.missingFiles,
            warnings: manifest.warnings,
        }, null, 2);
        details.style.margin = "8px 0 0";
        details.style.padding = "8px";
        details.style.maxHeight = "220px";
        details.style.overflow = "auto";
        details.style.whiteSpace = "pre-wrap";
        details.style.background = "rgba(15, 23, 42, 0.24)";
        details.style.borderRadius = "8px";
        summary.appendChild(details);
        container.appendChild(summary);
    };

    const rerenderPanels = (): void => {
        for (const container of mountedContainers) {
            renderPanel(container);
        }
    };

    const panelRegistration = pluginUiRegistry.registerPanel({
        id: "mme-compat-manifest-panel",
        title: "MME Compat",
        mount(container: HTMLElement): void {
            mountedContainers.add(container);
            renderPanel(container);
        },
        unmount(): void {
            for (const container of mountedContainers) {
                container.replaceChildren();
            }
            mountedContainers.clear();
        },
    });

    if (!panelRegistration.ok) {
        console.error(`[MMECompat] Failed to register UI panel: ${panelRegistration.id}`);
    }

    const pluginApi: InternalMmeCompatManifestPlugin = {
        id: "mme-compat-manifest",
        getManifest(): MMEManifest | null {
            return manifest;
        },
        getCurrentMmeManifest(): MMEManifest | null {
            return manifest;
        },
        discoverManifest(rootFile: string, files: readonly MmeCompatFileEntry[]): MMEManifest {
            registeredFiles.clear();
            for (const file of files) {
                const normalizedFile = normalizeRegisteredMmeFile(file);
                registeredFiles.set(normalizedFile.path, normalizedFile);
            }
            manifest = createMmeManifest(normalizeMmePath(rootFile), Array.from(registeredFiles.values()));
            lastPickerAcceptedCount = registeredFiles.size;
            resetInteractiveManifestState();
            rerenderPanels();
            return manifest;
        },
        registerMmeFile(file: MmeCompatFileEntry): MmeFileRegistrationResult {
            const normalizedFile = normalizeRegisteredMmeFile(file);
            const fileKind = getMmeFileKind(normalizedFile.path);
            if (fileKind !== "x" && fileKind !== "fx" && fileKind !== "fxsub" && fileKind !== "conf") {
                return {
                    ok: false,
                    manifest,
                    reason: "unsupported-extension",
                };
            }

            registeredFiles.set(normalizedFile.path, normalizedFile);
            rebuildManifestFromRegisteredFiles();
            rerenderPanels();
            return {
                ok: true,
                manifest,
            };
        },
        removeMmeFile(path: string): MmeFileRemovalResult {
            const normalizedPath = normalizeMmePath(path);
            if (!registeredFiles.has(normalizedPath)) {
                return {
                    ok: false,
                    manifest,
                    reason: "file-not-registered",
                };
            }

            registeredFiles.delete(normalizedPath);
            lastPickerWarnings = [];
            resetInteractiveManifestState();
            rebuildManifestFromRegisteredFiles();
            rerenderPanels();
            return {
                ok: true,
                manifest,
            };
        },
        clearManifest(): void {
            clearCurrentManifest();
        },
        clearMmeManifest(): void {
            clearCurrentManifest();
        },
        onDispose(): void {
            fallbackController.dispose();
            pluginUiRegistry.unregisterPanel("mme-compat-manifest-panel");
            mountedContainers.clear();
        },
    };

    return pluginApi;
}

function normalizeRegisteredMmeFile(file: MmeCompatFileEntry): MmeCompatFileEntry {
    return {
        ...file,
        path: normalizeMmePath(file.path),
    };
}

/**
 * Registration root policy:
 * - prefer the first registered .x file
 * - otherwise the first registered .fx file
 * - otherwise the first registered .fxsub file
 * - otherwise the first registered .conf file
 *
 * This lets a later accessory-style .x registration intentionally become the
 * manifest root while keeping insertion order stable within each file type.
 */
function selectRegisteredRootFile(files: readonly MmeCompatFileEntry[]): string | null {
    const rootKinds: readonly ("x" | "fx" | "fxsub" | "conf")[] = ["x", "fx", "fxsub", "conf"];

    for (const rootKind of rootKinds) {
        const match = files.find((file) => getMmeFileKind(file.path) === rootKind);
        if (match) {
            return match.path;
        }
    }

    return null;
}

export function getMmeFilePathFromPickerFile(file: Pick<MmePickerFileLike, "name" | "webkitRelativePath">): string {
    const preferredPath = typeof file.webkitRelativePath === "string" && file.webkitRelativePath.trim().length > 0
        ? file.webkitRelativePath
        : file.name;
    return preferredPath;
}

export async function registerPickedMmeFiles(params: {
    files: readonly MmePickerFileLike[];
    registerMmeFile: (file: MmeCompatFileEntry) => MmeFileRegistrationResult;
}): Promise<MmePickerRegistrationSummary> {
    const warnings: string[] = [];
    let acceptedCount = 0;
    let rejectedCount = 0;

    for (const file of params.files) {
        const path = getMmeFilePathFromPickerFile(file);
        const text = await file.text();
        const result = params.registerMmeFile({
            path,
            text,
        });
        if (result.ok) {
            acceptedCount += 1;
            continue;
        }

        rejectedCount += 1;
        if (result.reason === "unsupported-extension") {
            warnings.push(`Unsupported MME file skipped: ${path}`);
        } else {
            warnings.push(`MME file registration failed: ${path}`);
        }
    }

    return {
        acceptedCount,
        rejectedCount,
        warnings,
    };
}

export function getMmeCompatApplyStatus(
    state: Pick<MmeFallbackControllerState, "enabled" | "mode" | "experimentalApplyEnabled">,
    availability?: MmeFallbackApplyAvailability,
): string {
    if (!state.enabled) {
        return "disabled";
    }
    if (state.mode !== "apply") {
        return "preview-only";
    }
    if (!state.experimentalApplyEnabled) {
        return "experimental-disabled";
    }
    if (!availability) {
        return "experimental-apply-pending";
    }
    if (!availability.available) {
        return availability.reason;
    }
    return "ready (experimental basicToon apply)";
}

export function getMmeCompatApplyButtonState(
    availability: MmeFallbackApplyAvailability,
): MmeCompatApplyButtonState {
    return {
        enabled: availability.available,
        label: availability.available
            ? "Apply Fallback (experimental basicToon)"
            : "Apply Fallback (guarded)",
    };
}

export function getMmeCompatRevertButtonState(hasAppliedTransaction: boolean): MmeCompatRevertButtonState {
    return {
        enabled: hasAppliedTransaction,
        label: hasAppliedTransaction
            ? "Revert Fallback"
            : "Revert Fallback (waiting for applied transaction)",
    };
}

export function getMmeCompatHighlightButtonState(
    availability: { available: boolean },
): MmeCompatHighlightButtonState {
    return {
        enabled: availability.available,
        label: availability.available
            ? "Highlight Target (debug-only)"
            : "Highlight Target (guarded)",
    };
}

export function buildMmeCompatApplyPlanRows(
    applyPlan: MmeFallbackApplyTransaction | null,
    availability: MmeFallbackApplyAvailability,
): readonly MmeCompatApplyPlanRow[] {
    if (!applyPlan) {
        return [];
    }

    const validationReason = availability.available ? null : availability.reason;
    return applyPlan.targetRecords.map((record) => ({
        targetId: record.effectId,
        ownerName: record.targetName,
        meshName: record.meshName,
        materialName: record.materialName,
        originalMaterialAvailability: record.originalMaterialAvailable ? "available" : "unavailable",
        plannedFallbackPreset: record.plannedFallback.preset,
        matchingPolicy: record.matchingPolicy,
        validationReason,
    }));
}

export function formatMmeCompatApplyPlanRowLines(
    row: MmeCompatApplyPlanRow,
): readonly string[] {
    return [
        `effect id: ${row.targetId}`,
        `original material: ${row.originalMaterialAvailability}`,
        `preset: ${row.plannedFallbackPreset}`,
        `matching: ${row.matchingPolicy ?? "(unknown)"}`,
        `validation: ${row.validationReason ?? "ready"}`,
    ];
}

export function filterAndSortMmeTargetCandidates(
    candidates: readonly MmeFallbackTargetCandidate[],
    options: MmeCandidateViewOptions,
): readonly MmeFallbackTargetCandidate[] {
    const normalizedSearch = options.search.trim().toLowerCase();
    const filtered = candidates.filter((candidate) => {
        if (options.kind !== "all" && candidate.targetKind !== options.kind) return false;
        if (options.preset !== "all" && candidate.recommendedFallbackPreset !== options.preset) return false;
        if (options.status !== "all" && candidate.status !== options.status) return false;
        if (normalizedSearch.length === 0) return true;

        const haystack = [
            candidate.ownerName,
            candidate.meshName,
            candidate.materialName,
            candidate.effectId,
            candidate.sourcePath,
        ]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .join("\n")
            .toLowerCase();
        return haystack.includes(normalizedSearch);
    });

    const sorted = [...filtered];
    sorted.sort((left, right) => compareMmeTargetCandidates(left, right, options.sortKey));
    return sorted;
}

export function getSelectedMmeTargetCandidateDetail(
    candidates: readonly MmeFallbackTargetCandidate[],
    selectedCandidateId: string | null,
): MmeCandidateDetailState {
    if (!selectedCandidateId) {
        return {
            selectedCandidateId: null,
            selectedCandidate: null,
        };
    }

    const selectedCandidate = candidates.find((candidate) => candidate.targetId === selectedCandidateId) ?? null;
    return {
        selectedCandidateId: selectedCandidate?.targetId ?? null,
        selectedCandidate,
    };
}

export function getSelectedMmeTargetCandidateHighlightDetail(
    candidates: readonly MmeFallbackTargetCandidate[],
    selectedCandidateId: string | null,
): MmeCandidateHighlightDetailState {
    const detail = getSelectedMmeTargetCandidateDetail(candidates, selectedCandidateId);
    return {
        ...detail,
        highlightPlan: buildHighlightPlanForCandidate(detail.selectedCandidate),
    };
}

export function syncSelectedMmeTargetCandidateId(
    selectedCandidateId: string | null,
    candidates: readonly MmeFallbackTargetCandidate[],
): string | null {
    if (!selectedCandidateId) return null;
    return candidates.some((candidate) => candidate.targetId === selectedCandidateId)
        ? selectedCandidateId
        : null;
}

function buildPreviewInputsFromManifest(manifest: MMEManifest) {
    return Object.values(manifest.parsedEffects).map((effect) => ({
        effectId: effect.path,
        effect,
        targetName: effect.path.split("/").pop() ?? effect.path,
        materialName: effect.path.split("/").pop() ?? effect.path,
        sourcePath: effect.path,
    }));
}

function buildApplyInputsFromTargetsAndPreviewPlan(
    targets: readonly MaterialEffectTarget[],
    previewPlan: readonly MmeFallbackPreviewPlanItem[],
    manifest: MMEManifest,
) {
    if (targets.length === 0 || previewPlan.length === 0) {
        return [];
    }

    const matchingPolicy: "single-global-effect" | "multi-global-effect" = previewPlan.length === 1
        ? "single-global-effect"
        : "multi-global-effect";

    return targets.flatMap((target) => previewPlan.flatMap((entry) => {
        const effect = manifest.parsedEffects[entry.effectId];
        if (!effect) {
            return [];
        }

        return [{
            effectId: entry.effectId,
            effect,
            targetName: target.kind === "model" ? (target.modelName ?? target.name) : (target.accessoryName ?? target.name),
            meshName: target.meshName,
            materialName: target.materialName,
            mesh: target.mesh,
            originalMaterial: target.material,
            matchingPolicy,
            sourcePath: target.sourcePath,
            scene: typeof (target.mesh as { getScene?: () => unknown }).getScene === "function"
                ? ((target.mesh as { getScene: () => unknown }).getScene() as import("@babylonjs/core/scene").Scene | null)
                : null,
        }];
    }));
}

function formatMmeCompatActionResult(
    action: "Apply" | "Revert" | "Highlight",
    status: string,
    reason: string,
    warnings: readonly string[],
): string {
    const warningSuffix = warnings.length > 0 ? ` | ${warnings.join(" ; ")}` : "";
    return `${action}: ${status} (${reason})${warningSuffix}`;
}

function summarizeTargetCandidates(candidates: readonly MmeFallbackTargetCandidate[]) {
    return candidates.map((candidate) => ({
        targetId: candidate.targetId,
        effectId: candidate.effectId,
        targetKind: candidate.targetKind,
        ownerName: candidate.ownerName,
        meshName: candidate.meshName,
        materialName: candidate.materialName,
        sourcePath: candidate.sourcePath,
        preset: candidate.recommendedFallbackPreset,
        confidence: Number(candidate.confidence.toFixed(2)),
        status: candidate.status,
        blockedReasons: candidate.blockedReasons,
        matchingPolicy: candidate.matchingPolicy,
        warnings: candidate.warnings,
    }));
}

function summarizeMappedTextureCandidates(mappedFields: Readonly<Record<string, unknown>>) {
    const textureFieldKeys = ["diffuseTexture", "emissiveTexture", "normalMap", "toonRamp", "sphereMap"] as const;
    return textureFieldKeys
        .map((fieldKey) => {
            const field = mappedFields[fieldKey] as {
                name?: string;
                reference?: string | null;
                resolvedPath?: string | null;
                status?: string;
            } | null | undefined;
            if (!field) return null;
            return {
                type: fieldKey,
                name: field.name ?? null,
                reference: field.reference ?? null,
                resolvedPath: field.resolvedPath ?? null,
                status: field.status ?? "unresolved",
            };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

type MmeTexturePreviewSummaryEntry = {
    readonly label: "Diffuse" | "Toon" | "Sphere";
    readonly status: "resolved" | "candidate-only" | "none";
    readonly reference: string | null;
    readonly resolvedPath: string | null;
};

export function buildMmeTexturePreviewSummaryEntries(
    mappedFields: Readonly<Record<string, unknown>>,
): readonly MmeTexturePreviewSummaryEntry[] {
    const summarizedCandidates = summarizeMappedTextureCandidates(mappedFields);
    const candidateByType = new Map(summarizedCandidates.map((candidate) => [candidate.type, candidate]));

    return [
        buildMmeTexturePreviewSummaryEntry("Diffuse", candidateByType.get("diffuseTexture")),
        buildMmeTexturePreviewSummaryEntry("Toon", candidateByType.get("toonRamp")),
        buildMmeTexturePreviewSummaryEntry("Sphere", candidateByType.get("sphereMap")),
    ];
}

export function formatMmeTexturePreviewSummary(
    effectId: string,
    mappedFields: Readonly<Record<string, unknown>>,
): string {
    const lines = [`Effect: ${effectId}`];

    for (const entry of buildMmeTexturePreviewSummaryEntries(mappedFields)) {
        lines.push(formatMmeTexturePreviewSummaryEntry(entry));
    }

    return lines.join("\n");
}

function createMmeTexturePreviewSummaryCards(
    previewPlan: readonly MmeFallbackPreviewPlanItem[],
): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.display = "grid";
    wrapper.style.gap = "8px";
    wrapper.style.marginTop = "8px";
    wrapper.style.maxHeight = "220px";
    wrapper.style.overflow = "auto";

    for (const entry of previewPlan) {
        const effectCard = document.createElement("div");
        effectCard.style.display = "grid";
        effectCard.style.gap = "6px";
        effectCard.style.padding = "8px";
        effectCard.style.background = "rgba(15, 23, 42, 0.18)";
        effectCard.style.border = "1px solid rgba(148, 163, 184, 0.2)";
        effectCard.style.borderRadius = "8px";

        const effectTitle = document.createElement("div");
        effectTitle.textContent = `Effect: ${entry.effectId}`;
        effectTitle.style.fontWeight = "600";
        effectCard.appendChild(effectTitle);

        for (const textureEntry of buildMmeTexturePreviewSummaryEntries(entry.mappedFields)) {
            effectCard.appendChild(createMmeTexturePreviewSummaryRow(textureEntry));
        }

        wrapper.appendChild(effectCard);
    }

    return wrapper;
}

function createMmeCompatApplyPlanView(
    rows: readonly MmeCompatApplyPlanRow[],
    availability: MmeFallbackApplyAvailability,
): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.display = "grid";
    wrapper.style.gap = "8px";
    wrapper.style.marginTop = "8px";

    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.style.padding = "8px";
        empty.style.background = "rgba(15, 23, 42, 0.18)";
        empty.style.border = "1px solid rgba(148, 163, 184, 0.2)";
        empty.style.borderRadius = "8px";
        empty.textContent = `No apply plan. Availability: ${availability.reason}`;
        wrapper.appendChild(empty);
        return wrapper;
    }

    for (const row of rows) {
        const card = document.createElement("div");
        card.style.display = "grid";
        card.style.gap = "4px";
        card.style.padding = "8px";
        card.style.background = "rgba(15, 23, 42, 0.18)";
        card.style.border = "1px solid rgba(148, 163, 184, 0.2)";
        card.style.borderRadius = "8px";

        const title = document.createElement("div");
        title.textContent = `${row.ownerName ?? "(unknown owner)"} | ${row.meshName ?? "(unknown mesh)"} | ${row.materialName ?? "(unknown material)"}`;
        title.style.fontWeight = "600";
        card.appendChild(title);

        for (const line of formatMmeCompatApplyPlanRowLines(row)) {
            const detail = document.createElement("div");
            detail.textContent = line;
            detail.style.fontSize = "12px";
            detail.style.opacity = "0.78";
            card.appendChild(detail);
        }

        wrapper.appendChild(card);
    }

    return wrapper;
}

function buildMmeTexturePreviewSummaryEntry(
    label: MmeTexturePreviewSummaryEntry["label"],
    candidate: ReturnType<typeof summarizeMappedTextureCandidates>[number] | undefined,
): MmeTexturePreviewSummaryEntry {
    if (!candidate) {
        return {
            label,
            status: "none",
            reference: null,
            resolvedPath: null,
        };
    }

    const status = candidate.status === "resolved" || candidate.status === "candidate-only"
        ? candidate.status
        : "none";

    return {
        label,
        status,
        reference: candidate.reference,
        resolvedPath: candidate.resolvedPath,
    };
}

function createMmeTexturePreviewSummaryRow(entry: MmeTexturePreviewSummaryEntry): HTMLElement {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gap = "2px";
    row.style.padding = "6px 8px";
    row.style.background = "rgba(15, 23, 42, 0.14)";
    row.style.borderRadius = "6px";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.gap = "8px";

    const label = document.createElement("span");
    label.textContent = entry.label;
    label.style.fontWeight = "600";

    const status = document.createElement("span");
    status.textContent = entry.status;
    status.style.opacity = "0.8";

    header.appendChild(label);
    header.appendChild(status);
    row.appendChild(header);

    if (entry.reference) {
        const reference = document.createElement("div");
        reference.textContent = `ref: ${entry.reference}`;
        reference.style.fontSize = "12px";
        reference.style.opacity = "0.78";
        row.appendChild(reference);
    }

    if (entry.resolvedPath) {
        const path = document.createElement("div");
        path.textContent = `path: ${entry.resolvedPath}`;
        path.style.fontSize = "12px";
        path.style.opacity = "0.78";
        row.appendChild(path);
    } else if (entry.status !== "none") {
        const unresolved = document.createElement("div");
        unresolved.textContent = "path: (unresolved)";
        unresolved.style.fontSize = "12px";
        unresolved.style.opacity = "0.78";
        row.appendChild(unresolved);
    }

    return row;
}

function formatMmeTexturePreviewSummaryEntry(entry: MmeTexturePreviewSummaryEntry): string {
    if (entry.status === "none") {
        return `${entry.label}: none`;
    }

    const displayReference = entry.reference ?? "(unknown reference)";
    const displayPath = entry.resolvedPath ?? "(unresolved)";
    return `${entry.label}: ${entry.status} (${displayReference})\n  ref: "${displayReference}"\n  path: ${displayPath}`;
}

function compareMmeTargetCandidates(
    left: MmeFallbackTargetCandidate,
    right: MmeFallbackTargetCandidate,
    sortKey: MmeCandidateSortKey,
): number {
    switch (sortKey) {
    case "ownerName":
        return compareStrings(left.ownerName, right.ownerName)
            || compareStrings(left.materialName, right.materialName);
    case "materialName":
        return compareStrings(left.materialName, right.materialName)
            || compareStrings(left.ownerName, right.ownerName);
    case "preset":
        return compareStrings(left.recommendedFallbackPreset, right.recommendedFallbackPreset)
            || compareStrings(left.materialName, right.materialName);
    case "confidenceDesc":
    default:
        return (right.confidence - left.confidence)
            || compareStrings(left.ownerName, right.ownerName)
            || compareStrings(left.materialName, right.materialName);
    }
}

function compareStrings(left: string | null, right: string | null): number {
    return (left ?? "").localeCompare(right ?? "");
}

function createSelectControl(
    items: readonly { value: string; label: string }[],
    currentValue: string,
    onChange: (value: string) => void,
): HTMLSelectElement {
    const select = document.createElement("select");
    for (const item of items) {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        select.appendChild(option);
    }
    select.value = currentValue;
    select.addEventListener("change", () => {
        onChange(select.value);
    });
    return select;
}

function appendSummaryRow(container: HTMLElement, label: string, value: string): void {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.gap = "12px";

    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    labelEl.style.opacity = "0.75";

    const valueEl = document.createElement("span");
    valueEl.textContent = value;
    valueEl.style.textAlign = "right";

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    container.appendChild(row);
}
