import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Minimal read-only plugin API scaffold for future MME-oriented integrations.
 *
 * Current goal:
 * - expose stable hook and context shapes
 * - keep runtime ownership inside core code
 * - avoid external loading or behavior changes for now
 */

export type PluginEngine = Engine | WebGPUEngine;
export type PluginCamera = Camera | ArcRotateCamera;

export type PluginSceneRefs = {
    scene: Scene | null;
    engine: PluginEngine | null;
    camera: PluginCamera | null;
};

export interface PluginContext extends PluginSceneRefs {
    readonly host: PluginHost;
}

export type SceneHookContext = PluginContext;

export interface RenderHookContext extends PluginContext {
    readonly deltaTimeMs: number | null;
    readonly currentFrame: number | null;
    readonly totalFrames: number | null;
    readonly isPlaying: boolean | null;
}

export interface PluginMaterialTarget {
    readonly material: Material;
    readonly meshNames: readonly string[];
}

export interface ModelHookContext extends PluginContext {
    readonly modelIndex: number | null;
    readonly modelName: string | null;
    readonly modelPath: string | null;
    readonly rootMesh: AbstractMesh | null;
    readonly meshes: readonly AbstractMesh[];
    readonly materials: readonly PluginMaterialTarget[];
}

export interface AccessoryHookContext extends PluginContext {
    readonly accessoryIndex: number | null;
    readonly accessoryName: string | null;
    readonly accessoryPath: string | null;
    readonly accessoryKind: "x" | "glb" | null;
    readonly rootNode: AbstractMesh | null;
    readonly meshes: readonly AbstractMesh[];
    readonly materials: readonly PluginMaterialTarget[];
}

export interface ScenePlugin {
    readonly id: string;
    onSceneReady?(context: SceneHookContext): void;
    onBeforeRender?(context: RenderHookContext): void;
    onAfterRender?(context: RenderHookContext): void;
    onDispose?(context: SceneHookContext): void;
}

export interface AssetPlugin {
    readonly id: string;
    onModelLoaded?(context: ModelHookContext): void;
    onAccessoryLoaded?(context: AccessoryHookContext): void;
}

export interface EffectPlugin {
    readonly id: string;
    readonly kind: "material" | "postprocess" | "hybrid";
    onSceneReady?(context: SceneHookContext): void;
    onModelLoaded?(context: ModelHookContext): void;
    onAccessoryLoaded?(context: AccessoryHookContext): void;
    onBeforeRender?(context: RenderHookContext): void;
    onAfterRender?(context: RenderHookContext): void;
    onDispose?(context: SceneHookContext): void;
}

export type Plugin = ScenePlugin | AssetPlugin | EffectPlugin;

export interface PluginHost {
    readonly scene: Scene | null;
    readonly engine: PluginEngine | null;
    readonly camera: PluginCamera | null;
    readonly plugins: readonly Plugin[];
    registerPlugin(plugin: Plugin): void;
    unregisterPlugin(pluginId: string): boolean;
    emitSceneReady(context?: Partial<SceneHookContext>): void;
    emitBeforeRender(context?: Partial<RenderHookContext>): void;
    emitAfterRender(context?: Partial<RenderHookContext>): void;
    emitDispose(context?: Partial<SceneHookContext>): void;
    emitModelLoaded(context: ModelHookContext): void;
    emitAccessoryLoaded(context: AccessoryHookContext): void;
}
