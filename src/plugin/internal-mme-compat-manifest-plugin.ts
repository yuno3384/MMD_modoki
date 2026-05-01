import type { ScenePlugin } from "./plugin-types";
import { pluginUiRegistry } from "./ui-registry";
import {
    buildHighlightPlanForCandidate,
    MmeFallbackController,
    type MmeFallbackControllerState,
    type MmeFallbackHighlightPlan,
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

export type MmeCompatApplyStatus = "disabled" | "preview-only" | "experimental-disabled" | "apply not implemented";
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

export type InternalMmeCompatManifestPlugin = ScenePlugin & {
    getManifest(): MMEManifest | null;
    getCurrentMmeManifest(): MMEManifest | null;
    discoverManifest(rootFile: string, files: readonly MmeCompatFileEntry[]): MMEManifest;
    registerMmeFile(file: MmeCompatFileEntry): MmeFileRegistrationResult;
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
    let candidateViewOptions: MmeCandidateViewOptions = {
        kind: "all",
        preset: "all",
        status: "all",
        search: "",
        sortKey: "confidenceDesc",
    };

    const clearCurrentManifest = (): void => {
        manifest = null;
        registeredFiles.clear();
        lastPickerWarnings = [];
        lastPickerAcceptedCount = 0;
        selectedCandidateId = null;
        fallbackController.setEnabled(false);
        fallbackController.setExperimentalApplyEnabled(false);
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
        container.replaceChildren();

        const summary = document.createElement("div");
        summary.style.display = "grid";
        summary.style.gap = "6px";
        summary.style.fontSize = "12px";

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
        const applyPlan = fallbackController.getApplyPlan();
        appendSummaryRow(summary, "Fallback Preview", controllerState.enabled ? "ON" : "OFF");
        appendSummaryRow(summary, "Fallback Mode", controllerState.mode);
        appendSummaryRow(summary, "Preview Targets", String(controllerState.plannedTargets.length));
        appendSummaryRow(summary, "Experimental Apply Gate", applyGateStatus.experimentalApplyEnabled ? "ON" : "OFF");
        appendSummaryRow(summary, "Apply Status", getMmeCompatApplyStatus(controllerState));
        appendSummaryRow(summary, "Apply Plan Targets", String(applyPlan?.targetRecords.length ?? 0));

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
            fallbackController.setMode("preview");
            if (previewCheckbox.checked) {
                fallbackController.setEnabled(true);
            } else {
                fallbackController.setEnabled(false);
                selectedCandidateId = null;
            }
            rerenderPanels();
        });
        previewToggle.appendChild(previewCheckbox);
        previewToggle.appendChild(document.createTextNode("Enable Dry-Run Preview (diagnostic only)"));

        const modeSelect = document.createElement("select");
        modeSelect.disabled = true;
        const previewOption = document.createElement("option");
        previewOption.value = "preview";
        previewOption.textContent = "preview";
        const applyOption = document.createElement("option");
        applyOption.value = "apply";
        applyOption.textContent = "apply (TODO)";
        modeSelect.appendChild(previewOption);
        modeSelect.appendChild(applyOption);
        modeSelect.value = controllerState.mode;

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
            rerenderPanels();
        });
        experimentalApplyToggle.appendChild(experimentalApplyCheckbox);
        experimentalApplyToggle.appendChild(document.createTextNode("Experimental Apply Gate (opt-in only, no material application implemented yet)"));
        summary.appendChild(experimentalApplyToggle);

        const applyButton = document.createElement("button");
        applyButton.type = "button";
        applyButton.disabled = true;
        applyButton.textContent = "Apply Fallback (TODO)";
        applyButton.style.marginTop = "4px";
        summary.appendChild(applyButton);

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
                const targetCandidates = fallbackController.buildTargetCandidateView(
                    options.getSceneMaterialTargets?.() ?? [],
                    previewPlan,
                );
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
                candidateNotice.textContent = "Scene material target candidates. Read-only dry-run view only; no fallback material is applied.";
                summary.appendChild(candidateNotice);

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
                selectedCandidateId = syncSelectedMmeTargetCandidateId(selectedCandidateId, visibleCandidates);
                const selectedCandidateDetail = getSelectedMmeTargetCandidateHighlightDetail(visibleCandidates, selectedCandidateId);
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
                        highlightLabel.textContent = "Highlight plan. Planned only; target identity may be known, but highlight remains disabled unless effect binding is precise enough. No scene changes are performed.";
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
                        }, null, 2);
                        highlightDetail.style.margin = "8px 0 0";
                        highlightDetail.style.padding = "8px";
                        highlightDetail.style.maxHeight = "160px";
                        highlightDetail.style.overflow = "auto";
                        highlightDetail.style.whiteSpace = "pre-wrap";
                        highlightDetail.style.background = "rgba(15, 23, 42, 0.24)";
                        highlightDetail.style.borderRadius = "8px";
                        summary.appendChild(highlightDetail);

                        const highlightButton = document.createElement("button");
                        highlightButton.type = "button";
                        highlightButton.disabled = true;
                        highlightButton.textContent = "Highlight Target (TODO)";
                        highlightButton.style.marginTop = "4px";
                        summary.appendChild(highlightButton);
                    } else {
                        const inactiveDetail = document.createElement("div");
                        inactiveDetail.style.marginTop = "8px";
                        inactiveDetail.style.opacity = "0.75";
                        inactiveDetail.textContent = "No candidate selected.";
                        summary.appendChild(inactiveDetail);
                    }
                } else {
                    selectedCandidateId = null;
                    const emptyCandidates = document.createElement("div");
                    emptyCandidates.textContent = "No scene material target candidates match the current filters.";
                    emptyCandidates.style.marginTop = "8px";
                    emptyCandidates.style.opacity = "0.75";
                    summary.appendChild(emptyCandidates);
                }
            }
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
            const selectedRootFile = selectRegisteredRootFile(Array.from(registeredFiles.values()));
            manifest = selectedRootFile
                ? createMmeManifest(selectedRootFile, Array.from(registeredFiles.values()))
                : null;
            lastPickerAcceptedCount = registeredFiles.size;
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

export function getMmeCompatApplyStatus(state: Pick<MmeFallbackControllerState, "enabled" | "mode" | "experimentalApplyEnabled">): MmeCompatApplyStatus {
    if (!state.enabled) {
        return "disabled";
    }
    if (state.mode !== "apply") {
        return "preview-only";
    }
    if (!state.experimentalApplyEnabled) {
        return "experimental-disabled";
    }
    return "apply not implemented";
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
