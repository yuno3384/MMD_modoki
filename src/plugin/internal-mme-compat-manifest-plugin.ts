import type { ScenePlugin } from "./plugin-types";
import { pluginUiRegistry } from "./ui-registry";
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
        appendSummaryRow(summary, "Textures", String(manifest.textureCandidates.length));
        appendSummaryRow(summary, "Missing", String(manifest.missingFiles.length));
        appendSummaryRow(summary, "Warnings", String(manifest.warnings.length));

        const details = document.createElement("pre");
        details.textContent = JSON.stringify({
            rootFile: manifest.rootFile,
            discoveredFxFiles: manifest.discoveredFxFiles,
            discoveredFxSubFiles: manifest.discoveredFxSubFiles,
            discoveredConfFiles: manifest.discoveredConfFiles,
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
            rerenderPanels();
        },
        onDispose(): void {
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
