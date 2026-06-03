import { describe, expect, it } from "vitest";

import {
    createMmeManifest,
    extractMmeIncludePaths,
    getMmeFileKind,
    normalizeMmePath,
    resolveSameNameFxForX,
} from "./mme-compat-manifest";

describe("MME compat manifest helpers", () => {
    it("recognizes supported MME-related file types", () => {
        expect(getMmeFileKind("effect.fx")).toBe("fx");
        expect(getMmeFileKind("effect.fxsub")).toBe("fxsub");
        expect(getMmeFileKind("effect.conf")).toBe("conf");
        expect(getMmeFileKind("acc.x")).toBe("x");
        expect(getMmeFileKind("sphere.sph")).toBe("texture");
        expect(getMmeFileKind("notes.txt")).toBe("unknown");
    });

    it("normalizes windows-style and nested relative paths", () => {
        expect(normalizeMmePath("C:\\Effects\\..\\Effects\\toon\\main.fxsub")).toBe("C:/Effects/toon/main.fxsub");
        expect(normalizeMmePath(".\\include\\..\\common\\base.fxsub")).toBe("common/base.fxsub");
    });

    it("discovers same-name fx for x files in the same directory", () => {
        const resolved = resolveSameNameFxForX("C:\\Effects\\ray.x", [
            { path: "C:\\Effects\\ray.fx", text: "" },
        ]);

        expect(resolved).toBe("C:/Effects/ray.fx");
    });

    it("extracts include references and builds nested include graph", () => {
        expect(extractMmeIncludePaths('#include "common/base.fxsub"\n#include "lights.fxsub"')).toEqual([
            "common/base.fxsub",
            "lights.fxsub",
        ]);

        const manifest = createMmeManifest("C:\\Effects\\main.fx", [
            {
                path: "C:\\Effects\\main.fx",
                text: '#include "common/base.fxsub"\ntexture tex0 < string ResourceName = "tex/albedo.png"; >;',
            },
            {
                path: "C:\\Effects\\common\\base.fxsub",
                text: '#include "missing/extra.fxsub"',
            },
        ]);

        expect(manifest.discoveredFxFiles).toEqual(["C:/Effects/main.fx"]);
        expect(manifest.discoveredFxSubFiles).toEqual(["C:/Effects/common/base.fxsub"]);
        expect(manifest.includeGraph["C:/Effects/main.fx"]).toEqual(["C:/Effects/common/base.fxsub"]);
        expect(manifest.includeGraph["C:/Effects/common/base.fxsub"]).toEqual([]);
        expect(manifest.missingFiles).toContain("C:/Effects/common/missing/extra.fxsub");
        expect(manifest.textureCandidates).toEqual([
            {
                sourceFile: "C:/Effects/main.fx",
                reference: "tex/albedo.png",
                resolvedPath: null,
            },
        ]);
    });
});
