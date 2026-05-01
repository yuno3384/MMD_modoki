import { describe, expect, it } from "vitest";

import {
    createInternalMmeCompatManifestPlugin,
    getMmeCompatApplyStatus,
    getMmeFilePathFromPickerFile,
    registerPickedMmeFiles,
} from "./internal-mme-compat-manifest-plugin";
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
    it("formats apply status with the experimental gate priority", () => {
        expect(getMmeCompatApplyStatus({
            enabled: false,
            mode: "preview",
            experimentalApplyEnabled: false,
        })).toBe("disabled");

        expect(getMmeCompatApplyStatus({
            enabled: true,
            mode: "preview",
            experimentalApplyEnabled: false,
        })).toBe("preview-only");

        expect(getMmeCompatApplyStatus({
            enabled: true,
            mode: "apply",
            experimentalApplyEnabled: false,
        })).toBe("experimental-disabled");

        expect(getMmeCompatApplyStatus({
            enabled: true,
            mode: "apply",
            experimentalApplyEnabled: true,
        })).toBe("apply not implemented");
    });

    it("prefers webkitRelativePath for picked files when available", () => {
        expect(getMmeFilePathFromPickerFile({
            name: "main.fx",
            webkitRelativePath: "bundle/main.fx",
        })).toBe("bundle/main.fx");

        expect(getMmeFilePathFromPickerFile({
            name: "fallback.fx",
            webkitRelativePath: "",
        })).toBe("fallback.fx");
    });

    it("accepted picked files pass registration", async () => {
        const registeredPaths: string[] = [];
        const summary = await registerPickedMmeFiles({
            files: [
                {
                    name: "main.fx",
                    async text() {
                        return `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`;
                    },
                },
            ],
            registerMmeFile(file) {
                registeredPaths.push(file.path);
                return {
                    ok: true,
                    manifest: null,
                };
            },
        });

        expect(registeredPaths).toEqual(["main.fx"]);
        expect(summary).toEqual({
            acceptedCount: 1,
            rejectedCount: 0,
            warnings: [],
        });
    });

    it("picked unsupported files produce safe warnings", async () => {
        const summary = await registerPickedMmeFiles({
            files: [
                {
                    name: "notes.txt",
                    async text() {
                        return "unsupported";
                    },
                },
            ],
            registerMmeFile() {
                return {
                    ok: false,
                    manifest: null,
                    reason: "unsupported-extension",
                };
            },
        });

        expect(summary.acceptedCount).toBe(0);
        expect(summary.rejectedCount).toBe(1);
        expect(summary.warnings).toEqual(["Unsupported MME file skipped: notes.txt"]);
    });

    it("picked multiple files preserve relative bundle paths where available", async () => {
        const registeredPaths: string[] = [];
        await registerPickedMmeFiles({
            files: [
                {
                    name: "ray.x",
                    webkitRelativePath: "bundle/ray.x",
                    async text() {
                        return "xof 0303txt 0032";
                    },
                },
                {
                    name: "ray.fx",
                    webkitRelativePath: "bundle/ray.fx",
                    async text() {
                        return `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`;
                    },
                },
            ],
            registerMmeFile(file) {
                registeredPaths.push(file.path);
                return {
                    ok: true,
                    manifest: null,
                };
            },
        });

        expect(registeredPaths).toEqual(["bundle/ray.x", "bundle/ray.fx"]);
    });

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
