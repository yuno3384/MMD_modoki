import { describe, expect, it } from "vitest";

import { analyzeMmeEffectIR } from "./mme-effect-mapper";
import { parseMmeEffectFile } from "./mme-fx-parser";

describe("analyzeMmeEffectIR", () => {
    it("classifies a simple toon-like effect as partially mapped", () => {
        const effect = parseMmeEffectFile({
            path: "toon.fx",
            kind: "fx",
            text: `
float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);
float Alpha = 0.85;
texture ToonRamp;
sampler2D ToonSampler = sampler_state { Texture = <ToonRamp>; };
`,
        });

        const analysis = analyzeMmeEffectIR(effect);

        expect(analysis.status).toBe("partiallyMapped");
        expect(analysis.mappedFields.diffuseColor?.name).toBe("Diffuse");
        expect(analysis.mappedFields.alpha?.name).toBe("Alpha");
        expect(analysis.mappedFields.toonRamp?.name).toBe("ToonRamp");
    });

    it("classifies a texture-only material effect as partially mapped", () => {
        const effect = parseMmeEffectFile({
            path: "tex.fx",
            kind: "fx",
            text: `
texture MainTex;
sampler2D DiffuseSampler = sampler_state { Texture = <MainTex>; };
texture SphereTex;
sampler2D SphereSampler = sampler_state { Texture = <SphereTex>; };
`,
        });

        const analysis = analyzeMmeEffectIR(effect);

        expect(analysis.status).toBe("partiallyMapped");
        expect(analysis.mappedFields.diffuseTexture?.name).toBe("MainTex");
        expect(analysis.mappedFields.sphereMap?.name).toBe("SphereTex");
    });

    it("classifies multipass or postprocess-like effects as unsupported", () => {
        const effect = parseMmeEffectFile({
            path: "post.fx",
            kind: "fx",
            text: `
texture SceneTex : COLOR0;
texture BloomTex : COLOR1;
technique Post {
    pass PrePass {
        RenderTarget[0] = <SceneTex>;
        VertexShader = compile vs_3_0 VSMain();
    }
    pass MainPass {
        PixelShader = compile ps_3_0 PSMain();
        RenderTarget[1] = <BloomTex>;
    }
}
`,
        });

        const analysis = analyzeMmeEffectIR(effect);

        expect(analysis.status).toBe("unsupported");
        expect(analysis.unsupportedFeatures).toContain("custom vertex shader");
        expect(analysis.unsupportedFeatures).toContain("custom pixel shader");
        expect(analysis.unsupportedFeatures).toContain("multiple render targets");
        expect(analysis.unsupportedFeatures).toContain("complex passes");
    });

    it("keeps unknown effects as parsed with warnings when no safe mapping exists", () => {
        const effect = parseMmeEffectFile({
            path: "unknown.fx",
            kind: "fx",
            text: `
float StrangeValue : FROB = 1;
struct VS_INPUT {
    float4 pos : POSITION;
};
`,
        });

        const analysis = analyzeMmeEffectIR(effect);

        expect(["parsed", "unsupported"]).toContain(analysis.status);
        expect(analysis.warnings.length).toBeGreaterThan(0);
    });

    it("marks empty input as failed", () => {
        const effect = parseMmeEffectFile({
            path: "empty.fx",
            kind: "fx",
            text: ``,
        });

        const analysis = analyzeMmeEffectIR(effect);

        expect(analysis.status).toBe("failed");
        expect(analysis.reason).toContain("No recognizable effect structure");
    });
});
