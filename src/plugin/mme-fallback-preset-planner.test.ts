import { describe, expect, it } from "vitest";

import { analyzeMmeEffectIR } from "./mme-effect-mapper";
import { planMmeFallbackPreset } from "./mme-fallback-preset-planner";
import { parseMmeEffectFile } from "./mme-fx-parser";

describe("planMmeFallbackPreset", () => {
    it("plans basicToon for diffuse-only effects", () => {
        const effect = parseMmeEffectFile({
            path: "basic.fx",
            kind: "fx",
            text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("basicToon");
    });

    it("plans textureToon for diffuse texture or toon ramp effects", () => {
        const effect = parseMmeEffectFile({
            path: "texture.fx",
            kind: "fx",
            text: `
texture MainTex;
texture ToonRamp;
sampler2D MainSampler = sampler_state { Texture = <MainTex>; };
`,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect, {
            manifest: {
                textureCandidates: [
                    {
                        sourceFile: "texture.fx",
                        reference: "toon/toon01.bmp",
                        resolvedPath: "bundle/toon/toon01.bmp",
                    },
                ],
            },
        }), effect);

        expect(plan.preset).toBe("textureToon");
    });

    it("keeps unresolved textureToon preview candidates preview-only with warnings", () => {
        const effect = parseMmeEffectFile({
            path: "texture-weak.fx",
            kind: "fx",
            text: `
texture MainTex;
sampler2D MainSampler = sampler_state { Texture = <MainTex>; };
`,
        });

        const analysis = analyzeMmeEffectIR(effect, {
            manifest: {
                textureCandidates: [
                    {
                        sourceFile: "texture-weak.fx",
                        reference: "textures/unknown_asset.png",
                        resolvedPath: "bundle/textures/unknown_asset.png",
                    },
                ],
            },
        });
        const plan = planMmeFallbackPreset(analysis, effect);

        expect(plan.preset).toBe("none");
        expect(plan.warnings.some((warning) => warning.includes("preview-only"))).toBe(true);
        expect(plan.reasons.some((reason) => reason.includes("no useful texture candidate resolved safely"))).toBe(true);
    });

    it("keeps unresolved toon ramp-only evidence conservative with warnings", () => {
        const effect = parseMmeEffectFile({
            path: "toon-ramp-weak.fx",
            kind: "fx",
            text: `
texture ToonRamp;
sampler2D ToonSampler = sampler_state { Texture = <ToonRamp>; };
`,
        });

        const analysis = analyzeMmeEffectIR(effect, {
            manifest: {
                textureCandidates: [
                    {
                        sourceFile: "toon-ramp-weak.fx",
                        reference: "textures/unknown_asset.png",
                        resolvedPath: "bundle/textures/unknown_asset.png",
                    },
                ],
            },
        });
        const plan = planMmeFallbackPreset(analysis, effect);

        expect(plan.preset).toBe("none");
        expect(plan.warnings.some((warning) => warning.includes("Toon ramp candidate is preview-only"))).toBe(true);
    });

    it("plans katameLike for sphere/specular-heavy effects", () => {
        const effect = parseMmeEffectFile({
            path: "katame.fx",
            kind: "fx",
            text: `
float3 SpecularColor : SPECULAR = float3(1, 1, 1);
float SpecularPower = 32;
texture SphereTex : SPHERE;
`,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("katameLike");
    });

    it("plans emissiveLite for emissive effects", () => {
        const effect = parseMmeEffectFile({
            path: "emissive.fx",
            kind: "fx",
            text: `float4 Emissive : EMISSIVE = float4(1, 0.6, 0.2, 1);`,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("emissiveLite");
    });

    it("plans unsupported for custom shader or multipass effects", () => {
        const effect = parseMmeEffectFile({
            path: "unsupported.fx",
            kind: "fx",
            text: `
technique Post {
    pass P0 {
        VertexShader = compile vs_3_0 VSMain();
    }
    pass P1 {
        PixelShader = compile ps_3_0 PSMain();
        RenderTarget[1] = Tex;
    }
}
`,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("unsupported");
    });

    it("plans unsupported for failed analysis", () => {
        const effect = parseMmeEffectFile({
            path: "empty.fx",
            kind: "fx",
            text: ``,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("unsupported");
    });
});
