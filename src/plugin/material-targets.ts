import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";

type MaterialEffectRootNode = TransformNode | AbstractMesh | null;

type MaterialEffectTargetBase = {
    readonly name: string | null;
    readonly sourcePath: string | null;
    readonly rootNode: MaterialEffectRootNode;
    readonly mesh: AbstractMesh;
    readonly material: Material;
    readonly materialName: string;
    readonly meshName: string;
    readonly materialSlotIndex: number | null;
};

export type MaterialEffectTarget = ModelMaterialEffectTarget | AccessoryMaterialEffectTarget;

export type ModelMaterialEffectTarget = MaterialEffectTargetBase & {
    readonly kind: "model";
    readonly modelIndex: number | null;
    readonly modelName: string | null;
};

export type AccessoryMaterialEffectTarget = MaterialEffectTargetBase & {
    readonly kind: "accessory";
    readonly accessoryIndex: number | null;
    readonly accessoryName: string | null;
    readonly accessoryKind: "x" | "glb" | null;
};

type CollectMaterialTargetsBaseArgs = {
    readonly name?: string | null;
    readonly sourcePath?: string | null;
    readonly rootNode?: MaterialEffectRootNode;
    readonly meshes: readonly AbstractMesh[];
};

type CollectModelMaterialTargetsArgs = CollectMaterialTargetsBaseArgs & {
    readonly modelIndex?: number | null;
    readonly modelName?: string | null;
};

type CollectAccessoryMaterialTargetsArgs = CollectMaterialTargetsBaseArgs & {
    readonly accessoryIndex?: number | null;
    readonly accessoryName?: string | null;
    readonly accessoryKind?: "x" | "glb" | null;
};

/**
 * Enumerates stable mesh-material pairs for future material/effect integrations.
 *
 * Duplicate handling policy:
 * - one target per unique mesh-material pair
 * - shared materials across multiple meshes produce multiple targets
 * - repeated references to the same material within the same mesh are collapsed
 */
export function collectMaterialTargetsFromMeshes(
    args: CollectModelMaterialTargetsArgs | CollectAccessoryMaterialTargetsArgs,
): MaterialEffectTarget[] {
    const kind = "accessoryIndex" in args || "accessoryKind" in args ? "accessory" : "model";
    const targets: MaterialEffectTarget[] = [];
    const seenByMesh = new WeakMap<AbstractMesh, Set<Material>>();

    const pushTarget = (mesh: AbstractMesh, material: Material, materialSlotIndex: number | null): void => {
        const seenMaterials = seenByMesh.get(mesh) ?? new Set<Material>();
        if (seenMaterials.has(material)) return;
        seenMaterials.add(material);
        seenByMesh.set(mesh, seenMaterials);

        const baseTarget: MaterialEffectTargetBase = {
            name: args.name ?? null,
            sourcePath: args.sourcePath ?? null,
            rootNode: args.rootNode ?? null,
            mesh,
            material,
            materialName: getMaterialName(material),
            meshName: getMeshName(mesh),
            materialSlotIndex,
        };

        if (kind === "accessory") {
            const accessoryArgs = args as CollectAccessoryMaterialTargetsArgs;
            targets.push({
                ...baseTarget,
                kind: "accessory",
                accessoryIndex: accessoryArgs.accessoryIndex ?? null,
                accessoryName: accessoryArgs.accessoryName ?? accessoryArgs.name ?? null,
                accessoryKind: accessoryArgs.accessoryKind ?? null,
            });
            return;
        }

        const modelArgs = args as CollectModelMaterialTargetsArgs;
        targets.push({
            ...baseTarget,
            kind: "model",
            modelIndex: modelArgs.modelIndex ?? null,
            modelName: modelArgs.modelName ?? modelArgs.name ?? null,
        });
    };

    for (const mesh of args.meshes) {
        const material = mesh.material;
        const multiMaterial = asMultiMaterial(material);
        if (multiMaterial) {
            for (let subIndex = 0; subIndex < multiMaterial.subMaterials.length; subIndex += 1) {
                const subMaterial = asMaterial(multiMaterial.subMaterials[subIndex] ?? null);
                if (!subMaterial) continue;
                pushTarget(mesh, subMaterial, subIndex);
            }
            continue;
        }

        const singleMaterial = asMaterial(material);
        if (!singleMaterial) continue;
        pushTarget(mesh, singleMaterial, null);
    }

    return targets;
}

export function collectModelMaterialTargets(
    args: CollectModelMaterialTargetsArgs,
): ModelMaterialEffectTarget[] {
    return collectMaterialTargetsFromMeshes(args) as ModelMaterialEffectTarget[];
}

export function collectAccessoryMaterialTargets(
    args: CollectAccessoryMaterialTargetsArgs,
): AccessoryMaterialEffectTarget[] {
    return collectMaterialTargetsFromMeshes(args) as AccessoryMaterialEffectTarget[];
}

function asMaterial(value: unknown): Material | null {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray((value as { subMaterials?: unknown }).subMaterials)) return null;
    return value as Material;
}

function asMultiMaterial(value: unknown): MultiMaterial | null {
    if (!value || typeof value !== "object") return null;
    if (!Array.isArray((value as { subMaterials?: unknown }).subMaterials)) return null;
    return value as MultiMaterial;
}

function getMeshName(mesh: AbstractMesh): string {
    return typeof mesh.name === "string" && mesh.name.length > 0 ? mesh.name : "mesh";
}

function getMaterialName(material: Material): string {
    return typeof material.name === "string" && material.name.length > 0 ? material.name : "material";
}
