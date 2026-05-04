import { describe, expect, it, vi } from "vitest";

import { MmeFallbackController } from "./mme-fallback-controller";
import { parseMmeEffectFile } from "./mme-fx-parser";
import type { MaterialEffectTarget } from "./material-targets";

const highlightLayerInstances: Array<{
    readonly addMesh: ReturnType<typeof vi.fn>;
    readonly removeMesh: ReturnType<typeof vi.fn>;
    readonly dispose: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@babylonjs/core/Layers/highlightLayer", () => ({
    HighlightLayer: class MockHighlightLayer {
        public readonly addMesh = vi.fn();
        public readonly removeMesh = vi.fn();
        public readonly dispose = vi.fn();

        public constructor() {
            highlightLayerInstances.push(this);
        }
    },
}));

vi.mock("./mme-fallback-material-factory", () => ({
    createMmeFallbackMaterial(params: {
        dryRun?: boolean;
        plan: { preset: string; missingFields: readonly string[]; blockedByUnsupportedFeatures: readonly string[] };
    }) {
        const dryRun = params.dryRun ?? true;
        const warnings: string[] = [];

        if (params.plan.preset === "unsupported" || params.plan.preset === "none") {
            return {
                status: "unsupported",
                preset: params.plan.preset,
                materialName: "mock_unsupported",
                materialType: "none",
                warnings,
            };
        }
        if (params.plan.missingFields.length > 0) {
            return {
                status: "skipped",
                preset: params.plan.preset,
                materialName: "mock_skipped",
                materialType: "none",
                warnings: [...warnings, `Missing required fields: ${params.plan.missingFields.join(", ")}`],
            };
        }
        if (params.plan.blockedByUnsupportedFeatures.length > 0 || params.plan.preset === "katameLike") {
            return {
                status: "unsupported",
                preset: params.plan.preset,
                materialName: "mock_blocked",
                materialType: "none",
                warnings: [...warnings, "Blocked by unsupported features"],
            };
        }

        if (dryRun) {
            return {
                status: "created",
                preset: params.plan.preset,
                materialName: `mock_${params.plan.preset}`,
                materialType: "StandardMaterial",
                warnings,
            };
        }

        return {
            status: "created",
            preset: params.plan.preset,
            materialName: `mock_${params.plan.preset}`,
            materialType: "StandardMaterial",
            warnings,
            createdMaterial: {
                name: `mock_${params.plan.preset}`,
                dispose: vi.fn(),
            },
        };
    },
    disposeMmeFallbackMaterial(resultOrMaterial: { createdMaterial?: { dispose?: () => void }; dispose?: () => void } | null | undefined) {
        if (!resultOrMaterial) return;
        if ("createdMaterial" in resultOrMaterial) {
            resultOrMaterial.createdMaterial?.dispose?.();
            return;
        }
        resultOrMaterial.dispose?.();
    },
}));

describe("MmeFallbackController", () => {
    it("starts disabled in preview mode", () => {
        const controller = new MmeFallbackController();

        expect(controller.getState()).toMatchObject({
            enabled: false,
            mode: "preview",
            experimentalApplyEnabled: false,
            selectedEffectId: null,
            activeTargets: [],
            plannedTargets: [],
        });
        expect(controller.getApplyPlan()).toBeNull();
    });

    it("preview mode does not mutate input targets and returns no plan while disabled", () => {
        const controller = new MmeFallbackController();
        const input = {
            effectId: "basic",
            targetName: "body",
            materialName: "mat_body",
            effect: parseMmeEffectFile({
                path: "basic.fx",
                kind: "fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            }),
        };

        const previewPlan = controller.buildPreviewPlan([input]);

        expect(previewPlan).toEqual([]);
        expect(input.targetName).toBe("body");
        expect(input.materialName).toBe("mat_body");
    });

    it("includes unsupported plans in preview output when enabled", () => {
        const controller = new MmeFallbackController();
        controller.setEnabled(true);

        const previewPlan = controller.buildPreviewPlan([
            {
                effectId: "unsupported",
                materialName: "postfx_mat",
                effect: parseMmeEffectFile({
                    path: "unsupported.fx",
                    kind: "fx",
                    text: `
technique Post {
    pass P0 {
        PixelShader = compile ps_3_0 PSMain();
    }
}
`,
                }),
            },
        ]);

        expect(previewPlan).toHaveLength(1);
        expect(previewPlan[0].analysisStatus).toBe("unsupported");
        expect(previewPlan[0].preset).toBe("unsupported");
        expect(previewPlan[0].factoryStatus).toBe("unsupported");
    });

    it("builds preview output when explicitly enabled in preview mode", () => {
        const controller = new MmeFallbackController();
        controller.setMode("preview");
        controller.setEnabled(true);

        const previewPlan = controller.buildPreviewPlan([
            {
                effectId: "basic",
                materialName: "mat_body",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);

        expect(previewPlan).toHaveLength(1);
        expect(controller.getState()).toMatchObject({
            enabled: true,
            mode: "preview",
        });
    });

    it("disabling preview clears preview state without mutating input", () => {
        const controller = new MmeFallbackController();
        const input = {
            effectId: "basic",
            targetName: "body",
            materialName: "mat_body",
            effect: parseMmeEffectFile({
                path: "basic.fx",
                kind: "fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            }),
        };

        controller.setEnabled(true);
        expect(controller.buildPreviewPlan([input])).toHaveLength(1);

        controller.setEnabled(false);

        expect(controller.getState()).toMatchObject({
            enabled: false,
            plannedTargets: [],
            activeTargets: [],
        });
        expect(input.targetName).toBe("body");
        expect(input.materialName).toBe("mat_body");
    });

    it("disabling the controller clears the apply plan through the shared cleanup path", () => {
        const controller = new MmeFallbackController();

        controller.planApply([
            {
                effectId: "basic",
                materialName: "mat_body",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);
        expect(controller.getApplyPlan()).not.toBeNull();

        controller.setEnabled(false);

        expect(controller.getApplyPlan()).toBeNull();
        expect(controller.getState()).toMatchObject({
            enabled: false,
            plannedTargets: [],
            activeTargets: [],
        });
    });

    it("guards apply path unless explicitly enabled and switched to apply mode", () => {
        const controller = new MmeFallbackController();

        expect(controller.getApplyAvailability()).toMatchObject({
            available: false,
            reason: "controller-disabled",
        });
        expect(controller.applyFallback()).toMatchObject({
            status: "blocked",
            reason: "controller-disabled",
        });

        controller.setEnabled(true);
        expect(controller.getApplyAvailability()).toMatchObject({
            available: false,
            reason: "not-apply-mode",
        });
        expect(controller.applyFallback()).toMatchObject({
            status: "blocked",
            reason: "not-apply-mode",
        });

        controller.setMode("apply");
        expect(controller.getApplyAvailability()).toMatchObject({
            available: false,
            reason: "experimental-apply-disabled",
        });
        expect(controller.applyFallback()).toMatchObject({
            status: "blocked",
            reason: "experimental-apply-disabled",
        });

        controller.planApply([
            {
                effectId: "basic",
                mesh: createMockMesh("BodyMesh"),
                matchingPolicy: "single-global-effect",
                materialName: "mat_body",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);
        controller.setExperimentalApplyEnabled(true);
        expect(controller.getApplyAvailability()).toMatchObject({
            available: true,
            reason: "apply-ready",
        });
        expect(controller.applyFallback()).toMatchObject({
            status: "blocked",
            reason: "scene-unavailable",
        });
    });

    it("keeps experimental apply disabled by default and reports gate status", () => {
        const controller = new MmeFallbackController();

        expect(controller.isExperimentalApplyEnabled()).toBe(false);
        expect(controller.getApplyGateStatus()).toEqual({
            experimentalApplyEnabled: false,
        });
    });

    it("builds read-only scene material target candidates from preview output", () => {
        const controller = new MmeFallbackController();
        controller.setMode("preview");
        controller.setEnabled(true);

        const previewPlan = controller.buildPreviewPlan([
            {
                effectId: "basic",
                materialName: "mat_body",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);

        const meshMaterialTarget = createMockMaterialTarget({
            kind: "model",
            ownerName: "Miku",
            meshName: "BodyMesh",
            materialName: "BodyMaterial",
            sourcePath: "model.pmx",
        });

        const candidates = controller.buildTargetCandidateView([meshMaterialTarget], previewPlan);

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            effectId: "basic",
            targetKind: "model",
            ownerName: "Miku",
            meshName: "BodyMesh",
            materialName: "BodyMaterial",
            recommendedFallbackPreset: "basicToon",
            matchingPolicy: "single-global-effect",
        });
        expect(meshMaterialTarget.materialName).toBe("BodyMaterial");
        expect(controller.getTargetCandidates()).toHaveLength(1);
    });

    it("labels candidates conservatively as unmatched when no preview effect exists", () => {
        const controller = new MmeFallbackController();
        const accessoryTarget = createMockMaterialTarget({
            kind: "accessory",
            ownerName: "RayAccessory",
            meshName: "AccessoryMesh",
            materialName: "AccessoryMaterial",
            sourcePath: "ray.x",
        });

        const candidates = controller.buildTargetCandidateView([accessoryTarget], []);

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            effectId: null,
            targetKind: "accessory",
            recommendedFallbackPreset: "none",
            status: "unmatched",
            matchingPolicy: "unmatched",
        });
    });

    it("planApply creates a planned transaction without mutating preview state", () => {
        const controller = new MmeFallbackController();
        const originalMaterial = { name: "original_mat" } as unknown as import("@babylonjs/core/Materials/material").Material;
        const transaction = controller.planApply([
            {
                effectId: "basic",
                targetName: "body",
                materialName: "mat_body",
                originalMaterial,
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);

        expect(transaction).not.toBeNull();
        expect(transaction).toMatchObject({
            status: "planned",
        });
        expect(transaction?.targetRecords).toHaveLength(1);
        expect(transaction?.targetRecords[0].materialName).toBe("mat_body");
        expect(transaction?.targetRecords[0].originalMaterial).toBe(originalMaterial);
        expect(transaction?.targetRecords[0].originalMaterialAvailable).toBe(true);
        expect(controller.getState().plannedTargets).toEqual([]);
    });

    it("planApply records unavailable original material clearly when not provided", () => {
        const controller = new MmeFallbackController();

        const transaction = controller.planApply([
            {
                effectId: "basic",
                materialName: "mat_body",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);

        expect(transaction?.targetRecords[0].originalMaterial).toBeNull();
        expect(transaction?.targetRecords[0].originalMaterialAvailable).toBe(false);
        expect(controller.getState().plannedTargets).toEqual([]);
    });

    it("revertApply is a safe no-op when no applied transaction exists", () => {
        const controller = new MmeFallbackController();

        expect(controller.revertApply()).toMatchObject({
            status: "noop",
            reason: "no-transaction",
        });

        controller.planApply([
            {
                effectId: "basic",
                materialName: "mat_body",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);

        expect(controller.revertApply()).toMatchObject({
            status: "noop",
            reason: "transaction-not-applied",
        });
    });

    it("applies a basicToon fallback and reverts it back to the original material", () => {
        const controller = new MmeFallbackController();
        const scene = {} as import("@babylonjs/core/scene").Scene;
        const originalMaterial = createMockMaterial("original_mat");
        const mesh = createMockMesh("BodyMesh", originalMaterial, scene);

        controller.setEnabled(true);
        controller.setMode("apply");
        controller.setExperimentalApplyEnabled(true);
        controller.planApply([
            {
                effectId: "basic",
                targetName: "Miku",
                meshName: "BodyMesh",
                materialName: "BodyMaterial",
                mesh,
                scene,
                originalMaterial,
                matchingPolicy: "single-global-effect",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);

        const applyResult = controller.applyFallback();
        expect(applyResult).toMatchObject({
            status: "applied",
            reason: "apply-succeeded",
        });
        const fallbackMaterial = mesh.material as import("@babylonjs/core/Materials/material").Material;
        expect(fallbackMaterial).not.toBe(originalMaterial);
        expect(controller.getApplyPlan()?.status).toBe("applied");

        const revertResult = controller.revertApply();
        expect(revertResult).toMatchObject({
            status: "reverted",
            reason: "revert-succeeded",
        });
        expect(mesh.material).toBe(originalMaterial);
        expect(((fallbackMaterial as unknown) as { dispose?: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalledTimes(1);
        expect(controller.getApplyPlan()?.status).toBe("reverted");
    });

    it("blocks apply when any candidate is invalid and leaves all meshes unchanged", () => {
        const controller = new MmeFallbackController();
        const scene = {} as import("@babylonjs/core/scene").Scene;
        const originalMaterialA = createMockMaterial("original_a");
        const originalMaterialB = createMockMaterial("original_b");
        const meshA = createMockMesh("BodyMesh", originalMaterialA, scene);
        const meshB = createMockMesh("FaceMesh", originalMaterialB, scene);

        controller.setEnabled(true);
        controller.setMode("apply");
        controller.setExperimentalApplyEnabled(true);
        controller.planApply([
            {
                effectId: "basic",
                targetName: "Miku",
                meshName: "BodyMesh",
                materialName: "BodyMaterial",
                mesh: meshA,
                scene,
                originalMaterial: originalMaterialA,
                matchingPolicy: "single-global-effect",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
            {
                effectId: "basic-face",
                targetName: "Miku",
                meshName: "FaceMesh",
                materialName: "FaceMaterial",
                mesh: meshB,
                scene,
                originalMaterial: originalMaterialB,
                matchingPolicy: "multi-global-effect",
                effect: parseMmeEffectFile({
                    path: "basic-face.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);

        const applyResult = controller.applyFallback();
        expect(applyResult).toMatchObject({
            status: "blocked",
            reason: "apply-targets-invalid",
        });
        expect(meshA.material).toBe(originalMaterialA);
        expect(meshB.material).toBe(originalMaterialB);
        expect(controller.getApplyPlan()?.status).toBe("planned");
    });

    it("blocks duplicate same-mesh targets before any mesh.material assignment", () => {
        const controller = new MmeFallbackController();
        const scene = {} as import("@babylonjs/core/scene").Scene;
        const originalMaterial = createMockMaterial("original_shared");
        const mesh = createMockMesh("BodyMesh", originalMaterial, scene);

        controller.setEnabled(true);
        controller.setMode("apply");
        controller.setExperimentalApplyEnabled(true);
        controller.planApply([
            {
                effectId: "basic-a",
                targetName: "Miku",
                meshName: "BodyMesh",
                materialName: "BodyMaterialA",
                mesh,
                scene,
                originalMaterial,
                matchingPolicy: "single-global-effect",
                effect: parseMmeEffectFile({
                    path: "basic-a.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
            {
                effectId: "basic-b",
                targetName: "Miku",
                meshName: "BodyMesh",
                materialName: "BodyMaterialB",
                mesh,
                scene,
                originalMaterial,
                matchingPolicy: "single-global-effect",
                effect: parseMmeEffectFile({
                    path: "basic-b.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);

        const applyResult = controller.applyFallback();

        expect(applyResult).toMatchObject({
            status: "blocked",
            reason: "duplicate-mesh-target",
        });
        expect(mesh.material).toBe(originalMaterial);
        expect(((originalMaterial as unknown) as { dispose?: ReturnType<typeof vi.fn> }).dispose).not.toHaveBeenCalled();
        expect(controller.getApplyPlan()?.status).toBe("planned");
    });

    it("dispose clears state", () => {
        const controller = new MmeFallbackController();
        controller.setEnabled(true);
        controller.setExperimentalApplyEnabled(true);
        controller.buildPreviewPlan([
            {
                effectId: "basic",
                materialName: "mat_body",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);
        controller.planApply([
            {
                effectId: "basic",
                materialName: "mat_body",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);
        controller.buildTargetCandidateView([
            createMockMaterialTarget({
                kind: "model",
                ownerName: "Miku",
                meshName: "BodyMesh",
                materialName: "BodyMaterial",
                sourcePath: "model.pmx",
            }),
        ], controller.getState().plannedTargets);

        controller.dispose();

        expect(controller.getState()).toMatchObject({
            enabled: false,
            experimentalApplyEnabled: false,
            selectedEffectId: null,
            activeTargets: [],
            plannedTargets: [],
        });
        expect(controller.getApplyPlan()).toBeNull();
        expect(controller.getTargetCandidates()).toEqual([]);
    });

    it("does not allow debug highlight for unmatched or multi-global candidates", () => {
        const controller = new MmeFallbackController();
        controller.setEnabled(true);
        const unmatchedTargets = [
            createMockMaterialTarget({
                kind: "model",
                ownerName: "Miku",
                meshName: "BodyMesh",
                materialName: "BodyMaterial",
                sourcePath: "model.pmx",
            }),
        ];
        controller.buildTargetCandidateView(unmatchedTargets, []);

        expect(controller.getHighlightAvailability("model::model.pmx::BodyMesh::BodyMaterial::single", unmatchedTargets)).toMatchObject({
            available: false,
            reason: "candidate-unmatched",
        });

        const multiController = new MmeFallbackController();
        multiController.setEnabled(true);
        const previewPlan = multiController.buildPreviewPlan([
            {
                effectId: "basic-a",
                materialName: "BodyMaterial",
                effect: parseMmeEffectFile({
                    path: "basic-a.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
            {
                effectId: "basic-b",
                materialName: "BodyMaterial",
                effect: parseMmeEffectFile({
                    path: "basic-b.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);
        const targets = [
            createMockMaterialTarget({
                kind: "model",
                ownerName: "Miku",
                meshName: "BodyMesh",
                materialName: "BodyMaterial",
                sourcePath: "model.pmx",
            }),
        ];
        multiController.buildTargetCandidateView(targets, previewPlan);
        expect(multiController.getHighlightAvailability("model::model.pmx::BodyMesh::BodyMaterial::single", targets)).toMatchObject({
            available: false,
            reason: "effect-binding-not-precise",
        });
    });

    it("blocks debug highlight when the candidate mesh cannot be resolved", () => {
        const controller = new MmeFallbackController();
        controller.setEnabled(true);
        const previewPlan = controller.buildPreviewPlan([
            {
                effectId: "basic",
                materialName: "BodyMaterial",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);
        const targetWithoutScene = createMockMaterialTarget({
            kind: "model",
            ownerName: "Miku",
            meshName: "BodyMesh",
            materialName: "BodyMaterial",
            sourcePath: "model.pmx",
        });
        controller.buildTargetCandidateView([targetWithoutScene], previewPlan);

        expect(controller.getHighlightAvailability("model::model.pmx::BodyMesh::BodyMaterial::single", [targetWithoutScene])).toMatchObject({
            available: false,
            reason: "scene-unavailable",
        });
    });

    it("replaces previous debug highlight and clears it safely", () => {
        highlightLayerInstances.length = 0;
        const controller = new MmeFallbackController();
        controller.setEnabled(true);
        const scene = {} as import("@babylonjs/core/scene").Scene;
        const previewPlan = controller.buildPreviewPlan([
            {
                effectId: "basic",
                materialName: "BodyMaterial",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);
        const targetA = createMockMaterialTarget({
            kind: "model",
            ownerName: "Miku",
            meshName: "BodyMesh",
            materialName: "BodyMaterial",
            sourcePath: "model.pmx",
            scene,
        });
        const targetB = createMockMaterialTarget({
            kind: "accessory",
            ownerName: "Accessory",
            meshName: "AccessoryMesh",
            materialName: "AccessoryMaterial",
            sourcePath: "ray.x",
            scene,
        });
        const targets = [targetA, targetB];
        controller.buildTargetCandidateView(targets, previewPlan);

        const firstResult = controller.highlightSelectedCandidate("model::model.pmx::BodyMesh::BodyMaterial::single", targets);
        expect(firstResult).toMatchObject({
            status: "highlighted",
            reason: "highlight-active",
        });
        expect(controller.getHighlightState()).toMatchObject({
            active: true,
            candidateId: "model::model.pmx::BodyMesh::BodyMaterial::single",
        });

        const firstLayer = highlightLayerInstances[0];
        const secondResult = controller.highlightSelectedCandidate("accessory::ray.x::AccessoryMesh::AccessoryMaterial::single", targets);
        expect(secondResult).toMatchObject({
            status: "highlighted",
            reason: "highlight-active",
        });
        expect(firstLayer.removeMesh).toHaveBeenCalledTimes(1);
        expect(firstLayer.dispose).toHaveBeenCalledTimes(1);

        const clearResult = controller.clearHighlight();
        expect(clearResult).toMatchObject({
            status: "cleared",
            reason: "highlight-cleared",
        });
        expect(controller.getHighlightState().active).toBe(false);
    });

    it("dispose clears debug highlight state without mutating mesh materials", () => {
        highlightLayerInstances.length = 0;
        const controller = new MmeFallbackController();
        controller.setEnabled(true);
        const scene = {} as import("@babylonjs/core/scene").Scene;
        const originalMaterial = createMockMaterial("original_body");
        const previewPlan = controller.buildPreviewPlan([
            {
                effectId: "basic",
                materialName: "BodyMaterial",
                effect: parseMmeEffectFile({
                    path: "basic.fx",
                    kind: "fx",
                    text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
                }),
            },
        ]);
        const target = createMockMaterialTarget({
            kind: "model",
            ownerName: "Miku",
            meshName: "BodyMesh",
            materialName: "BodyMaterial",
            sourcePath: "model.pmx",
            scene,
            material: originalMaterial,
        });
        controller.buildTargetCandidateView([target], previewPlan);
        controller.highlightSelectedCandidate("model::model.pmx::BodyMesh::BodyMaterial::single", [target]);

        controller.dispose();

        expect(controller.getHighlightState()).toMatchObject({
            active: false,
        });
        expect(target.mesh.material).toBe(originalMaterial);
    });
});

function createMockMaterialTarget(params: {
    kind: MaterialEffectTarget["kind"];
    ownerName: string;
    meshName: string;
    materialName: string;
    sourcePath: string;
    scene?: import("@babylonjs/core/scene").Scene | null;
    material?: import("@babylonjs/core/Materials/material").Material | null;
}): MaterialEffectTarget {
    const material = params.material ?? ({ name: params.materialName } as unknown as import("@babylonjs/core/Materials/material").Material);
    const mesh = {
        name: params.meshName,
        material,
        getScene: params.scene ? (() => params.scene) : undefined,
    } as unknown as import("@babylonjs/core/Meshes/abstractMesh").AbstractMesh;

    if (params.kind === "model") {
        return {
            kind: "model",
            name: params.ownerName,
            modelIndex: 0,
            modelName: params.ownerName,
            sourcePath: params.sourcePath,
            rootNode: null,
            mesh,
            material,
            materialName: params.materialName,
            meshName: params.meshName,
            materialSlotIndex: null,
        };
    }

    return {
        kind: "accessory",
        name: params.ownerName,
        accessoryIndex: 0,
        accessoryName: params.ownerName,
        accessoryKind: "x",
        sourcePath: params.sourcePath,
        rootNode: null,
        mesh,
        material,
        materialName: params.materialName,
        meshName: params.meshName,
        materialSlotIndex: null,
    };
}

function createMockMesh(
    name: string,
    material: import("@babylonjs/core/Materials/material").Material | null = null,
    scene: import("@babylonjs/core/scene").Scene | null = null,
): import("@babylonjs/core/Meshes/abstractMesh").AbstractMesh {
    return {
        name,
        material,
        getScene: scene ? (() => scene) : undefined,
    } as unknown as import("@babylonjs/core/Meshes/abstractMesh").AbstractMesh;
}

function createMockMaterial(name: string): import("@babylonjs/core/Materials/material").Material {
    return {
        name,
        dispose: vi.fn(),
    } as unknown as import("@babylonjs/core/Materials/material").Material;
}
