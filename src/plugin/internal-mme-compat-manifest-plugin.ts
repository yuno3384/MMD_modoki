import type { ScenePlugin } from "./plugin-types";
import { pluginUiRegistry } from "./ui-registry";
import { analyzeMmeEffectIR } from "./mme-effect-mapper";
import { MmeFallbackController } from "./mme-fallback-controller";
import { createMmeFallbackMaterial } from "./mme-fallback-material-factory";
import { planMmeFallbackPreset } from "./mme-fallback-preset-planner";
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
        appendSummaryRow(summary, "Fallback Preview", controllerState.enabled ? "ON" : "OFF");
        appendSummaryRow(summary, "Fallback Mode", controllerState.mode);
        appendSummaryRow(summary, "Preview Targets", String(controllerState.plannedTargets.length));

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

        const parsedEffects = Object.values(manifest.parsedEffects);
        if (parsedEffects.length > 0) {
            fallbackController.clearPreview();
            const analyses = parsedEffects.map((effect) => ({
                path: effect.path,
                analysis: analyzeMmeEffectIR(effect, { manifest }),
                plan: planMmeFallbackPreset(analyzeMmeEffectIR(effect, { manifest }), effect, { manifest }),
            }));
            const previewPlan = fallbackController.buildPreviewPlan(parsedEffects.map((effect) => ({
                effectId: effect.path,
                effect,
                targetName: effect.path.split("/").pop() ?? effect.path,
                materialName: effect.path.split("/").pop() ?? effect.path,
                sourcePath: effect.path,
            })), { manifest });
            const parsedSummary = document.createElement("pre");
            parsedSummary.textContent = JSON.stringify(analyses.map(({ path, analysis, plan }) => {
                const factoryResult = createMmeFallbackMaterial({
                    scene: null,
                    plan,
                    analysis,
                    targetMetadata: {
                        targetName: path.split("/").pop() ?? path,
                        sourcePath: path,
                    },
                    dryRun: true,
                });

                return {
                path,
                status: analysis.status,
                confidence: Number(analysis.confidence.toFixed(2)),
                fallbackPreset: plan.preset,
                fallbackConfidence: Number(plan.confidence.toFixed(2)),
                fallbackReasons: plan.reasons,
                fallbackMaterialStatus: factoryResult.status,
                fallbackMaterialType: factoryResult.materialType,
                fallbackMaterialWarnings: factoryResult.warnings,
                mappedFields: Object.fromEntries(Object.entries(analysis.mappedFields)
                    .filter(([, value]) => value !== null)),
                unsupportedFeatures: plan.blockedByUnsupportedFeatures,
                warnings: plan.warnings,
                previewPlanStatus: previewPlan.find((entry) => entry.effectId === path)?.factoryStatus ?? "skipped",
                };
            }), null, 2);
            parsedSummary.style.margin = "8px 0 0";
            parsedSummary.style.padding = "8px";
            parsedSummary.style.maxHeight = "180px";
            parsedSummary.style.overflow = "auto";
            parsedSummary.style.whiteSpace = "pre-wrap";
            parsedSummary.style.background = "rgba(15, 23, 42, 0.24)";
            parsedSummary.style.borderRadius = "8px";
            summary.appendChild(parsedSummary);
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
