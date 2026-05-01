import type { ScenePlugin } from "./plugin-types";
import { pluginUiRegistry } from "./ui-registry";
import { MmeFallbackController } from "./mme-fallback-controller";
import {
    createMmeManifest,
    getMmeFileKind,
    normalizeMmePath,
    type MMEManifest,
    type MmeCompatFileEntry,
} from "./mme-compat-manifest";

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

export type InternalMmeCompatManifestPlugin = ScenePlugin & {
    getManifest(): MMEManifest | null;
    getCurrentMmeManifest(): MMEManifest | null;
    discoverManifest(rootFile: string, files: readonly MmeCompatFileEntry[]): MMEManifest;
    registerMmeFile(file: MmeCompatFileEntry): MmeFileRegistrationResult;
    clearManifest(): void;
    clearMmeManifest(): void;
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
export function createInternalMmeCompatManifestPlugin(): InternalMmeCompatManifestPlugin {
    let manifest: MMEManifest | null = null;
    const registeredFiles = new Map<string, MmeCompatFileEntry>();
    const mountedContainers = new Set<HTMLElement>();
    const fallbackController = new MmeFallbackController();
    let lastPickerWarnings: string[] = [];
    let lastPickerAcceptedCount = 0;

    const clearCurrentManifest = (): void => {
        manifest = null;
        registeredFiles.clear();
        lastPickerWarnings = [];
        lastPickerAcceptedCount = 0;
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
        appendSummaryRow(summary, "Apply Status", controllerState.enabled
            ? (controllerState.mode === "apply" ? "apply not implemented" : "preview-only")
            : "disabled");
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

function buildPreviewInputsFromManifest(manifest: MMEManifest) {
    return Object.values(manifest.parsedEffects).map((effect) => ({
        effectId: effect.path,
        effect,
        targetName: effect.path.split("/").pop() ?? effect.path,
        materialName: effect.path.split("/").pop() ?? effect.path,
        sourcePath: effect.path,
    }));
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
