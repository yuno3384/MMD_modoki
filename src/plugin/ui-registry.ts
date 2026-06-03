/**
 * Minimal plugin UI registry.
 *
 * This is a small extension point for plugin-provided UI panels/actions without
 * redesigning the existing UI system. Future expansion is expected once plugin
 * loading and effect-specific UI surfaces become more formalized.
 */
export type PluginUiPanel = {
    id: string;
    title: string;
    mount: (container: HTMLElement) => void;
    unmount?: () => void;
};

export type PluginToolbarAction = {
    id: string;
    title: string;
    run: () => void;
};

export type PluginInspectorSection = {
    id: string;
    title: string;
    mount: (container: HTMLElement) => void;
    unmount?: () => void;
};

export type PluginUiRegistrationResult = {
    ok: boolean;
    id: string;
    reason?: "duplicate-id";
};

class PluginUiRegistry {
    private readonly panels = new Map<string, PluginUiPanel>();
    private readonly toolbarActions = new Map<string, PluginToolbarAction>();
    private readonly inspectorSections = new Map<string, PluginInspectorSection>();

    public registerPanel(panel: PluginUiPanel): PluginUiRegistrationResult {
        if (this.panels.has(panel.id)) {
            return { ok: false, id: panel.id, reason: "duplicate-id" };
        }
        this.panels.set(panel.id, panel);
        return { ok: true, id: panel.id };
    }

    public registerToolbarAction(action: PluginToolbarAction): PluginUiRegistrationResult {
        if (this.toolbarActions.has(action.id)) {
            return { ok: false, id: action.id, reason: "duplicate-id" };
        }
        this.toolbarActions.set(action.id, action);
        return { ok: true, id: action.id };
    }

    public registerInspectorSection(section: PluginInspectorSection): PluginUiRegistrationResult {
        if (this.inspectorSections.has(section.id)) {
            return { ok: false, id: section.id, reason: "duplicate-id" };
        }
        this.inspectorSections.set(section.id, section);
        return { ok: true, id: section.id };
    }

    public unregisterPanel(id: string): boolean {
        return this.panels.delete(id);
    }

    public unregisterToolbarAction(id: string): boolean {
        return this.toolbarActions.delete(id);
    }

    public unregisterInspectorSection(id: string): boolean {
        return this.inspectorSections.delete(id);
    }

    public getPanels(): readonly PluginUiPanel[] {
        return Array.from(this.panels.values());
    }

    public getToolbarActions(): readonly PluginToolbarAction[] {
        return Array.from(this.toolbarActions.values());
    }

    public getInspectorSections(): readonly PluginInspectorSection[] {
        return Array.from(this.inspectorSections.values());
    }
}

export const pluginUiRegistry = new PluginUiRegistry();
