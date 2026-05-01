import { describe, expect, it } from "vitest";

import { MmeFallbackController } from "./mme-fallback-controller";
import { parseMmeEffectFile } from "./mme-fx-parser";

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

        expect(controller.applyFallback()).toMatchObject({
            status: "blocked",
            reason: "controller-disabled",
        });

        controller.setEnabled(true);
        expect(controller.applyFallback()).toMatchObject({
            status: "blocked",
            reason: "not-apply-mode",
        });

        controller.setMode("apply");
        expect(controller.applyFallback()).toMatchObject({
            status: "blocked",
            reason: "experimental-apply-disabled",
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
        controller.setExperimentalApplyEnabled(true);
        expect(controller.applyFallback()).toMatchObject({
            status: "unsupported",
            reason: "apply-not-implemented",
        });
    });

    it("keeps experimental apply disabled by default and reports gate status", () => {
        const controller = new MmeFallbackController();

        expect(controller.isExperimentalApplyEnabled()).toBe(false);
        expect(controller.getApplyGateStatus()).toEqual({
            experimentalApplyEnabled: false,
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

        controller.dispose();

        expect(controller.getState()).toMatchObject({
            enabled: false,
            experimentalApplyEnabled: false,
            selectedEffectId: null,
            activeTargets: [],
            plannedTargets: [],
        });
        expect(controller.getApplyPlan()).toBeNull();
    });
});
