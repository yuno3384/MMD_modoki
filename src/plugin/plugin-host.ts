import type {
    AccessoryHookContext,
    AssetPlugin,
    EffectPlugin,
    ModelHookContext,
    Plugin,
    PluginCamera,
    PluginContext,
    PluginEngine,
    PluginHost,
    RenderHookContext,
    SceneHookContext,
    ScenePlugin,
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

    public registerPlugin(plugin: Plugin): void {
        this.pluginMap.set(plugin.id, plugin);
    }

    public unregisterPlugin(pluginId: string): boolean {
        return this.pluginMap.delete(pluginId);
    }

    public emitSceneReady(context: Partial<SceneHookContext> = {}): void {
        const hookContext = this.createSceneHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            (plugin as ScenePlugin | EffectPlugin).onSceneReady?.(hookContext);
        }
    }

    public emitBeforeRender(context: Partial<RenderHookContext> = {}): void {
        const hookContext = this.createRenderHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            (plugin as ScenePlugin | EffectPlugin).onBeforeRender?.(hookContext);
        }
    }

    public emitAfterRender(context: Partial<RenderHookContext> = {}): void {
        const hookContext = this.createRenderHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            (plugin as ScenePlugin | EffectPlugin).onAfterRender?.(hookContext);
        }
    }

    public emitDispose(context: Partial<SceneHookContext> = {}): void {
        const hookContext = this.createSceneHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            (plugin as ScenePlugin | EffectPlugin).onDispose?.(hookContext);
        }
    }

    public emitModelLoaded(context: ModelHookContext): void {
        const hookContext = this.createModelHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            (plugin as AssetPlugin | EffectPlugin).onModelLoaded?.(hookContext);
        }
    }

    public emitAccessoryLoaded(context: AccessoryHookContext): void {
        const hookContext = this.createAccessoryHookContext(context);
        for (const plugin of this.pluginMap.values()) {
            (plugin as AssetPlugin | EffectPlugin).onAccessoryLoaded?.(hookContext);
        }
    }

    private createBaseContext<TContext extends Partial<PluginContext>>(context: TContext): PluginContext {
        return {
            host: this,
            scene: context.scene ?? this.scene ?? null,
            engine: context.engine ?? this.engine ?? null,
            camera: context.camera ?? this.camera ?? null,
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
}

export function createPluginHost(refs: {
    scene?: PluginContext["scene"];
    engine?: PluginEngine | null;
    camera?: PluginCamera | null;
} = {}): PluginHost {
    return new NoopPluginHost(refs);
}
