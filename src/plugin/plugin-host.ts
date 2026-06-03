import type {
    AccessoryHookContext,
    ModelHookContext,
    Plugin,
    PluginCamera,
    PluginContext,
    PluginEngine,
    PluginHost,
    PluginRegistrationResult,
    PluginRuntimeContext,
    RenderHookContext,
    SceneHookContext,
} from "./plugin-types";

type PluginHostRefs = {
    scene?: PluginContext["scene"];
    engine?: PluginContext["engine"];
    camera?: PluginContext["camera"];
};

/**
 * No-op plugin registry for future MME-compatible extension points.
 *
 * Current limitations:
 * - no external plugin discovery or loading
 * - no runtime mutation surface
 * - no integration with MmdManager hooks yet
 * - duplicate plugin ids are rejected; existing registrations are preserved
 *
 * Intended future use:
 * - stable scene / asset / render hook dispatch
 * - effect adapters for MME-like material and post-process behavior
 */
export class NoopPluginHost implements PluginHost {
    private readonly pluginMap = new Map<string, Plugin>();

    public readonly scene: PluginContext["scene"];
    public readonly engine: PluginContext["engine"];
    public readonly camera: PluginContext["camera"];

    public constructor(refs: PluginHostRefs = {}) {
        this.scene = refs.scene ?? null;
        this.engine = refs.engine ?? null;
        this.camera = refs.camera ?? null;
    }

    public get plugins(): readonly Plugin[] {
        return Array.from(this.pluginMap.values());
    }

    public registerPlugin(plugin: Plugin): PluginRegistrationResult {
        if (this.pluginMap.has(plugin.id)) {
            console.error(`[PluginHost] Duplicate plugin id rejected: ${plugin.id}`);
            return {
                ok: false,
                reason: "duplicate-id",
                pluginId: plugin.id,
            };
        }
        this.pluginMap.set(plugin.id, plugin);
        return { ok: true };
    }

    public unregisterPlugin(pluginId: string): boolean {
        return this.pluginMap.delete(pluginId);
    }

    public emitSceneReady(context: Partial<SceneHookContext> = {}): void {
        const hookContext = this.createSceneHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            if (!hasOnSceneReady(plugin)) continue;
            this.invokePluginHook(plugin.id, "onSceneReady", () => plugin.onSceneReady(hookContext));
        }
    }

    public emitBeforeRender(context: Partial<RenderHookContext> = {}): void {
        const hookContext = this.createRenderHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            if (!hasOnBeforeRender(plugin)) continue;
            this.invokePluginHook(plugin.id, "onBeforeRender", () => plugin.onBeforeRender(hookContext));
        }
    }

    public emitAfterRender(context: Partial<RenderHookContext> = {}): void {
        const hookContext = this.createRenderHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            if (!hasOnAfterRender(plugin)) continue;
            this.invokePluginHook(plugin.id, "onAfterRender", () => plugin.onAfterRender(hookContext));
        }
    }

    public emitDispose(context: Partial<SceneHookContext> = {}): void {
        const hookContext = this.createSceneHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            if (!hasOnDispose(plugin)) continue;
            this.invokePluginHook(plugin.id, "onDispose", () => plugin.onDispose(hookContext));
        }
    }

    public emitModelLoaded(context: ModelHookContext): void {
        const hookContext = this.createModelHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            if (!hasOnModelLoaded(plugin)) continue;
            this.invokePluginHook(plugin.id, "onModelLoaded", () => plugin.onModelLoaded(hookContext));
        }
    }

    public emitAccessoryLoaded(context: AccessoryHookContext): void {
        const hookContext = this.createAccessoryHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            if (!hasOnAccessoryLoaded(plugin)) continue;
            this.invokePluginHook(plugin.id, "onAccessoryLoaded", () => plugin.onAccessoryLoaded(hookContext));
        }
    }

    private createRuntimeContext(context: Partial<PluginRuntimeContext>): PluginRuntimeContext {
        return Object.freeze({
            scene: context.scene ?? this.scene ?? null,
            engine: context.engine ?? this.engine ?? null,
            camera: context.camera ?? this.camera ?? null,
        });
    }

    private createBaseContext<TContext extends Partial<PluginContext>>(context: TContext): PluginContext {
        const runtime = this.createRuntimeContext(context);
        return {
            runtime,
            scene: runtime.scene,
            engine: runtime.engine,
            camera: runtime.camera,
        };
    }

    private createSceneHookContext(context: Partial<SceneHookContext>): SceneHookContext {
        return {
            ...this.createBaseContext(context),
        };
    }

    private createRenderHookContext(context: Partial<RenderHookContext>): RenderHookContext {
        return {
            ...this.createBaseContext(context),
            deltaTimeMs: context.deltaTimeMs ?? null,
            currentFrame: context.currentFrame ?? null,
            totalFrames: context.totalFrames ?? null,
            isPlaying: context.isPlaying ?? null,
        };
    }

    private createModelHookContext(context: ModelHookContext): ModelHookContext {
        return {
            ...this.createBaseContext(context),
            modelIndex: context.modelIndex ?? null,
            modelName: context.modelName ?? null,
            modelPath: context.modelPath ?? null,
            rootMesh: context.rootMesh ?? null,
            meshes: context.meshes ?? [],
            materials: context.materials ?? [],
        };
    }

    private createAccessoryHookContext(context: AccessoryHookContext): AccessoryHookContext {
        return {
            ...this.createBaseContext(context),
            accessoryIndex: context.accessoryIndex ?? null,
            accessoryName: context.accessoryName ?? null,
            accessoryPath: context.accessoryPath ?? null,
            accessoryKind: context.accessoryKind ?? null,
            rootNode: context.rootNode ?? null,
            meshes: context.meshes ?? [],
            materials: context.materials ?? [],
        };
    }

    private invokePluginHook(pluginId: string, hookName: string, callback: () => void): void {
        try {
            callback();
        } catch (error: unknown) {
            console.error(`[PluginHost] Plugin hook failed: ${pluginId}.${hookName}`, error);
        }
    }
}

function hasOnSceneReady(plugin: Plugin): plugin is Plugin & { onSceneReady: (context: SceneHookContext) => void } {
    return typeof (plugin as { onSceneReady?: unknown }).onSceneReady === "function";
}

function hasOnBeforeRender(plugin: Plugin): plugin is Plugin & { onBeforeRender: (context: RenderHookContext) => void } {
    return typeof (plugin as { onBeforeRender?: unknown }).onBeforeRender === "function";
}

function hasOnAfterRender(plugin: Plugin): plugin is Plugin & { onAfterRender: (context: RenderHookContext) => void } {
    return typeof (plugin as { onAfterRender?: unknown }).onAfterRender === "function";
}

function hasOnDispose(plugin: Plugin): plugin is Plugin & { onDispose: (context: SceneHookContext) => void } {
    return typeof (plugin as { onDispose?: unknown }).onDispose === "function";
}

function hasOnModelLoaded(plugin: Plugin): plugin is Plugin & { onModelLoaded: (context: ModelHookContext) => void } {
    return typeof (plugin as { onModelLoaded?: unknown }).onModelLoaded === "function";
}

function hasOnAccessoryLoaded(plugin: Plugin): plugin is Plugin & { onAccessoryLoaded: (context: AccessoryHookContext) => void } {
    return typeof (plugin as { onAccessoryLoaded?: unknown }).onAccessoryLoaded === "function";
}

export function createPluginHost(refs: {
    scene?: PluginContext["scene"];
    engine?: PluginEngine | null;
    camera?: PluginCamera | null;
} = {}): PluginHost {
    return new NoopPluginHost(refs);
}
