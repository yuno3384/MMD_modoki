import { describe, expect, it } from "vitest";

import type { MmeMappedTextureField } from "./mme-effect-mapper";
import {
    validateMmeTextureCandidate,
    validateTextureToonReadiness,
} from "./mme-texture-asset-validator";

describe("mme-texture-asset-validator", () => {
    it("accepts a resolved png when the registered file exists", () => {
        const result = validateMmeTextureCandidate(createTextureCandidate({
            reference: "textures/body.png",
            resolvedPath: "bundle/textures/body.png",
            status: "resolved",
        }), {
            files: [
                {
                    path: "bundle/textures/body.png",
                    bytes: new Uint8Array([1, 2, 3]),
                },
            ],
        });

        expect(result).toEqual({
            status: "valid",
            reference: "textures/body.png",
            resolvedPath: "bundle/textures/body.png",
            extension: ".png",
            reason: "texture-ready",
            warnings: [],
        });
    });

    it("treats candidate-only texture evidence as ambiguous", () => {
        const result = validateMmeTextureCandidate(createTextureCandidate({
            reference: "toon01.bmp",
            resolvedPath: null,
            status: "candidate-only",
        }));

        expect(result.status).toBe("ambiguous");
        expect(result.reason).toBe("texture-candidate-ambiguous");
        expect(result.resolvedPath).toBeNull();
    });

    it("reports a missing resolved texture when it is not registered", () => {
        const result = validateMmeTextureCandidate(createTextureCandidate({
            reference: "textures/body.png",
            resolvedPath: "bundle/textures/body.png",
            status: "resolved",
        }), {
            files: [
                {
                    path: "bundle/other.png",
                    bytes: new Uint8Array([1]),
                },
            ],
        });

        expect(result.status).toBe("missing");
        expect(result.reason).toBe("texture-file-missing");
        expect(result.warnings).toEqual(["Resolved texture is not registered: bundle/textures/body.png"]);
    });

    it("rejects unsupported texture extensions", () => {
        const result = validateMmeTextureCandidate(createTextureCandidate({
            reference: "textures/body.gif",
            resolvedPath: "bundle/textures/body.gif",
            status: "resolved",
        }), {
            files: [
                {
                    path: "bundle/textures/body.gif",
                    bytes: new Uint8Array([1]),
                },
            ],
        });

        expect(result.status).toBe("unsupported-extension");
        expect(result.extension).toBe(".gif");
        expect(result.reason).toBe("texture-extension-unsupported");
    });

    it("treats null or empty candidates as unresolved", () => {
        expect(validateMmeTextureCandidate(null).status).toBe("unresolved");
        expect(validateMmeTextureCandidate(createTextureCandidate({
            reference: "",
            resolvedPath: "",
            status: "unresolved",
        })).status).toBe("unresolved");
    });

    it("does not throw on malformed paths", () => {
        const result = validateMmeTextureCandidate(createTextureCandidate({
            reference: "???",
            resolvedPath: "bundle/???",
            status: "resolved",
        }), {
            files: [],
        });

        expect(result.status).toBe("unsupported-extension");
        expect(result.reason).toBe("texture-extension-unsupported");
    });

    it("validates textureToon readiness through the diffuse texture only", () => {
        const ready = validateTextureToonReadiness({
            diffuseTexture: createTextureCandidate({
                reference: "textures/body.dds",
                resolvedPath: "bundle/textures/body.dds",
                status: "resolved",
            }),
            context: {
                files: [
                    {
                        path: "bundle/textures/body.dds",
                        bytes: new Uint8Array([1]),
                    },
                ],
            },
        });

        expect(ready.ready).toBe(true);
        expect(ready.diffuseTexture.status).toBe("valid");

        const blocked = validateTextureToonReadiness({
            diffuseTexture: createTextureCandidate({
                reference: "textures/body.png",
                resolvedPath: null,
                status: "candidate-only",
            }),
        });

        expect(blocked.ready).toBe(false);
        expect(blocked.warnings).toContain("textureToon diffuse texture is not apply-ready: texture-candidate-ambiguous");
    });
});

function createTextureCandidate(params: {
    readonly reference: string | null;
    readonly resolvedPath: string | null;
    readonly status: MmeMappedTextureField["status"];
}): MmeMappedTextureField {
    return {
        name: "DiffuseTexture",
        reference: params.reference,
        resolvedPath: params.resolvedPath,
        status: params.status,
    };
}

