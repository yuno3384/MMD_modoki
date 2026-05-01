import { describe, expect, it } from "vitest";

import {
    collectAccessoryMaterialTargets,
    collectModelMaterialTargets,
} from "./material-targets";

function createMesh(name: string, material: unknown) {
    return {
        name,
        material,
    };
}

describe("collectModelMaterialTargets", () => {
    it("returns one target per mesh-material pair for shared materials", () => {
        const sharedMaterial = { name: "shared" };
        const targets = collectModelMaterialTargets({
            modelIndex: 2,
            modelName: "Miku",
            sourcePath: "C:\\Models\\miku.pmx",
            meshes: [
                createMesh("body", sharedMaterial),
                createMesh("hair", sharedMaterial),
            ] as never,
        });

        expect(targets).toHaveLength(2);
        expect(targets.map((target) => target.meshName)).toEqual(["body", "hair"]);
        expect(targets.every((target) => target.materialName === "shared")).toBe(true);
        expect(targets.every((target) => target.kind === "model")).toBe(true);
    });

    it("collapses duplicate submaterial references within the same mesh", () => {
        const repeatedMaterial = { name: "shared" };
        const targets = collectModelMaterialTargets({
            modelName: "Miku",
            meshes: [
                createMesh("body", {
                    name: "multi",
                    subMaterials: [repeatedMaterial, repeatedMaterial],
                }),
            ] as never,
        });

        expect(targets).toHaveLength(1);
        expect(targets[0].meshName).toBe("body");
        expect(targets[0].materialName).toBe("shared");
        expect(targets[0].materialSlotIndex).toBe(0);
    });
});

describe("collectAccessoryMaterialTargets", () => {
    it("includes accessory metadata and root node", () => {
        const material = { name: "acc" };
        const rootNode = { name: "accessory_root" };
        const targets = collectAccessoryMaterialTargets({
            accessoryIndex: 1,
            accessoryName: "Mic",
            accessoryKind: "x",
            sourcePath: "C:\\Acc\\mic.x",
            rootNode: rootNode as never,
            meshes: [
                createMesh("mic_mesh", material),
            ] as never,
        });

        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({
            kind: "accessory",
            accessoryIndex: 1,
            accessoryName: "Mic",
            accessoryKind: "x",
            rootNode,
            meshName: "mic_mesh",
            materialName: "acc",
        });
    });
});
