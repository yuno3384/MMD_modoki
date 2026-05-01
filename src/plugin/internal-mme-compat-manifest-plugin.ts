import type { ScenePlugin } from "./plugin-types";
import { pluginUiRegistry } from "./ui-registry";
import { MmeFallbackController } from "./mme-fallback-controller";
import {
    createMmeManifest,
    type MMEManifest,
    type MmeCompatFileEntry,
} from "./mme-compat-manifest";

export type InternalMmeCompatManifestPlugin = ScenePlugin & {
    getManifest(): MMEManifest | null;
    discoverManifest(rootFile: string, files: readonly MmeCompatFileEntry[]): MMEManifest;
    clearManifest(): void;
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
    const mountedContainers = new Set<HTMLElement>();
    const fallbackController = new MmeFallbackController();

    const renderPanel = (container: HTMLElement): void => {
        container.replaceChildren();

        const summary = document.createElement("div");
        summary.style.display = "grid";
        summary.style.gap = "6px";
        summary.style.fontSize = "12px";

        if (!manifest) {
            const empty = document.createElement("div");
            empty.textContent = "No MME manifest loaded yet.";
            empty.style.opacity = "0.8";
            summary.appendChild(empty);

            const note = document.createElement("div");
            note.textContent = "Future file-loading paths will call discoverManifest(...) for .x/.fx bundles.";
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
        const applyPlan = fallbackController.getApplyPlan();
        appendSummaryRow(summary, "Fallback Preview", controllerState.enabled ? "ON" : "OFF");
        appendSummaryRow(summary, "Fallback Mode", controllerState.mode);
        appendSummaryRow(summary, "Preview Targets", String(controllerState.plannedTargets.length));
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
        previewCheckbox.disabled = true;
        previewToggle.appendChild(previewCheckbox);
        previewToggle.appendChild(document.createTextNode("Enable Preview (disabled by default)"));

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
                ? "Dry-run diagnostic preview. No fallback materials are applied to scene meshes."
                : "Dry-run diagnostic preview is disabled by default. No analysis/planning preview is being computed.";
            summary.appendChild(previewNotice);

            if (controllerState.enabled) {
                const previewPlan = fallbackController.buildPreviewPlan(parsedEffects.map((effect) => ({
                    effectId: effect.path,
                    effect,
                    targetName: effect.path.split("/").pop() ?? effect.path,
                    materialName: effect.path.split("/").pop() ?? effect.path,
                    sourcePath: effect.path,
                })), { manifest });
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
            } else {
                fallbackController.clearPreview();
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

    return {
        id: "mme-compat-manifest",
        getManifest(): MMEManifest | null {
            return manifest;
        },
        discoverManifest(rootFile: string, files: readonly MmeCompatFileEntry[]): MMEManifest {
            manifest = createMmeManifest(rootFile, files);
            rerenderPanels();
            return manifest;
        },
        clearManifest(): void {
            manifest = null;
            fallbackController.clearPreview();
            fallbackController.clearApplyPlan();
            rerenderPanels();
        },
        onDispose(): void {
            fallbackController.dispose();
            pluginUiRegistry.unregisterPanel("mme-compat-manifest-panel");
            mountedContainers.clear();
        },
    };
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
