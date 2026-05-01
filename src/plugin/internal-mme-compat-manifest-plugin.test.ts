import { describe, expect, it } from "vitest";

import { createInternalMmeCompatManifestPlugin } from "./internal-mme-compat-manifest-plugin";
import type { SceneHookContext } from "./plugin-types";

const TEST_SCENE_CONTEXT: SceneHookContext = {
    runtime: {
        scene: null,
        engine: null,
        camera: null,
    },
    scene: null,
    engine: null,
    camera: null,
};

describe("InternalMmeCompatManifestPlugin", () => {
    it("normalizes duplicate path spellings to one registered file", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            plugin.registerMmeFile({
                path: "C:\\Effects\\\\main.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            const result = plugin.registerMmeFile({
                path: "C:/Effects/main.fx",
                text: `float4 Diffuse : DIFFUSE = float4(0, 0, 0, 1);`,
            });

            expect(result.ok).toBe(true);
            expect(result.manifest?.rootFile).toBe("C:/Effects/main.fx");
            expect(result.manifest?.discoveredFxFiles).toEqual(["C:/Effects/main.fx"]);
            expect(Object.keys(result.manifest?.parsedEffects ?? {})).toEqual(["C:/Effects/main.fx"]);
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("registering an fx file builds a manifest", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            const result = plugin.registerMmeFile({
                path: "C:\\Effects\\main.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });

            expect(result.ok).toBe(true);
            expect(result.manifest?.rootFile).toBe("C:/Effects/main.fx");
            expect(result.manifest?.discoveredFxFiles).toEqual(["C:/Effects/main.fx"]);
            expect(plugin.getCurrentMmeManifest()?.rootFile).toBe("C:/Effects/main.fx");
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("uses the first registered fx file as root when no x file exists", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            plugin.registerMmeFile({
                path: "C:\\Effects\\first.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            const result = plugin.registerMmeFile({
                path: "C:\\Effects\\second.fxsub",
                text: `float4 Diffuse : DIFFUSE = float4(0, 0, 0, 1);`,
            });

            expect(result.ok).toBe(true);
            expect(result.manifest?.rootFile).toBe("C:/Effects/first.fx");
            expect(result.manifest?.rootKind).toBe("fx");
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("promotes an x file to root even if an fx file was registered first", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            plugin.registerMmeFile({
                path: "C:\\Effects\\standalone.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            const result = plugin.registerMmeFile({
                path: "C:\\Effects\\ray.x",
                text: "xof 0303txt 0032",
            });

            expect(result.ok).toBe(true);
            expect(result.manifest?.rootFile).toBe("C:/Effects/ray.x");
            expect(result.manifest?.rootKind).toBe("x");
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("registering an x file can discover a same-name fx after it is added", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            const xResult = plugin.registerMmeFile({
                path: "C:\\Effects\\ray.x",
                text: "xof 0303txt 0032",
            });
            expect(xResult.ok).toBe(true);
            expect(xResult.manifest?.rootFile).toBe("C:/Effects/ray.x");
            expect(xResult.manifest?.discoveredFxFiles).toEqual([]);

            const fxResult = plugin.registerMmeFile({
                path: "C:\\Effects\\ray.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            expect(fxResult.ok).toBe(true);
            expect(fxResult.manifest?.rootFile).toBe("C:/Effects/ray.x");
            expect(fxResult.manifest?.discoveredFxFiles).toEqual(["C:/Effects/ray.fx"]);
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("rejects unsupported extensions", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            const result = plugin.registerMmeFile({
                path: "C:\\Effects\\notes.txt",
                text: "unsupported",
            });

            expect(result).toMatchObject({
                ok: false,
                reason: "unsupported-extension",
            });
            expect(plugin.getCurrentMmeManifest()).toBeNull();
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("clear resets the current manifest", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            plugin.registerMmeFile({
                path: "C:\\Effects\\main.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            expect(plugin.getCurrentMmeManifest()).not.toBeNull();

            plugin.clearMmeManifest();
            expect(plugin.getCurrentMmeManifest()).toBeNull();

            const result = plugin.registerMmeFile({
                path: "C:\\Effects\\after-clear.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            expect(result.manifest?.rootFile).toBe("C:/Effects/after-clear.fx");
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });
});
