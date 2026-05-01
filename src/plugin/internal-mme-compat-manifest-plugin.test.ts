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
