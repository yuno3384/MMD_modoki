import { describe, expect, it } from "vitest";

import { MmeFallbackController } from "./mme-fallback-controller";
import { parseMmeEffectFile } from "./mme-fx-parser";

describe("MmeFallbackController", () => {
    it("starts disabled in preview mode", () => {
        const controller = new MmeFallbackController();

        expect(controller.getState()).toMatchObject({
            enabled: false,
            mode: "preview",
            selectedEffectId: null,
            activeTargets: [],
            plannedTargets: [],
        });
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
        expect(previewPlan[0].factoryStatus).toBe("unsupported");
    });

    it("guards apply path unless explicitly enabled and switched to apply mode", () => {
        const controller = new MmeFallbackController();

        expect(controller.applyFallback()).toMatchObject({
            status: "blocked",
        });

        controller.setEnabled(true);
        expect(controller.applyFallback()).toMatchObject({
            status: "blocked",
        });

        controller.setMode("apply");
        expect(controller.applyFallback()).toMatchObject({
            status: "unsupported",
        });
    });

    it("dispose clears state", () => {
        const controller = new MmeFallbackController();
        controller.setEnabled(true);
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

        controller.dispose();

        expect(controller.getState()).toMatchObject({
            enabled: false,
            selectedEffectId: null,
            activeTargets: [],
            plannedTargets: [],
        });
    });
});
