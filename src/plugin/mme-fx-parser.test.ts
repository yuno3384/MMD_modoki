import { describe, expect, it } from "vitest";

import { parseMmeEffectFile } from "./mme-fx-parser";

describe("parseMmeEffectFile", () => {
    it("parses a simple toon-like effect structure", () => {
        const ir = parseMmeEffectFile({
            path: "toon.fx",
            kind: "fx",
            text: `
float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);
texture ToonTex;
sampler2D ToonSampler = sampler_state {
    Texture = <ToonTex>;
};
`,
        });

        expect(ir.parameters).toHaveLength(1);
        expect(ir.parameters[0]).toMatchObject({
            name: "Diffuse",
            type: "float4",
            semantic: "DIFFUSE",
            defaultValue: "float4(1, 1, 1, 1)",
        });
        expect(ir.textures.map((texture) => texture.name)).toEqual(["ToonTex"]);
        expect(ir.samplers[0]).toMatchObject({
            name: "ToonSampler",
            assignedTexture: "ToonTex",
        });
    });

    it("parses annotations and semantics", () => {
        const ir = parseMmeEffectFile({
            path: "annotated.fx",
            kind: "fx",
            text: `
float GlowPower : POWER < string UIName = "Glow"; float UIMin = 0; float UIMax = 5; > = 1.5;
float4x4 WorldViewProj : WORLDVIEWPROJECTION;
`,
        });

        expect(ir.parameters[0].annotations).toEqual([
            { type: "string", name: "UIName", value: "\"Glow\"" },
            { type: "float", name: "UIMin", value: "0" },
            { type: "float", name: "UIMax", value: "5" },
        ]);
        expect(ir.parameters[1]).toMatchObject({
            name: "WorldViewProj",
            semantic: "WORLDVIEWPROJECTION",
        });
    });

    it("parses include directives and technique/pass shader assignments", () => {
        const ir = parseMmeEffectFile({
            path: "main.fx",
            kind: "fx",
            text: `
#include "common/base.fxsub"
technique MainTech {
    pass P0 {
        VertexShader = compile vs_3_0 VSMain();
        PixelShader = compile ps_3_0 PSMain();
        AlphaBlendEnable = FALSE;
    }
}
`,
        });

        expect(ir.includes).toEqual(["common/base.fxsub"]);
        expect(ir.techniques).toHaveLength(1);
        expect(ir.techniques[0].passes[0]).toMatchObject({
            name: "P0",
            vertexShader: "compile vs_3_0 VSMain()",
            pixelShader: "compile ps_3_0 PSMain()",
        });
        expect(ir.techniques[0].passes[0].unknownStatements).toEqual(["AlphaBlendEnable = FALSE"]);
        expect(ir.warnings.some((warning) => warning.includes("unparsed statement"))).toBe(true);
    });

    it("parses render target declarations and pass assignments", () => {
        const ir = parseMmeEffectFile({
            path: "rt.fx",
            kind: "fx",
            text: `
texture SceneTex : COLOR0;
technique Render {
    pass P1 {
        RenderTarget[0] = <SceneTex>;
    }
}
`,
        });

        expect(ir.renderTargets).toEqual([
            {
                name: "SceneTex",
                semantic: "COLOR0",
                source: "declaration",
                passName: null,
                index: 0,
                assignment: null,
            },
            {
                name: "RenderTarget[0]",
                semantic: null,
                source: "pass-assignment",
                passName: "P1",
                index: 0,
                assignment: "<SceneTex>",
            },
        ]);
    });

    it("preserves unknown top-level syntax as raw snippets", () => {
        const ir = parseMmeEffectFile({
            path: "unknown.fx",
            kind: "fx",
            text: `
struct VS_INPUT {
    float4 pos : POSITION;
};
sampler WeirdSampler;
`,
        });

        expect(ir.unknownSnippets[0]).toContain("struct VS_INPUT");
        expect(ir.warnings.some((warning) => warning.includes("Unknown top-level snippet"))).toBe(true);
        expect(ir.samplers[0].name).toBe("WeirdSampler");
    });
});
