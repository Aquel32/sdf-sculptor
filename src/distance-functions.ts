import { d, std } from "typegpu";
import type { Infer } from "typegpu/data";
import { min } from "typegpu/std";

export const AABB = d.struct({
    min: d.vec3f,
    max: d.vec3f
});

export function aabbCylinder(pa: d.v3f, pb: d.v3f, ra: number) {
    "use gpu";
    const a = pb - pa;
    const e = d.f32(ra) * std.sqrt(1.0 - a * a / std.dot(a, a));
    return AABB({
        min: std.min(pa, pb) - e,
        max: std.max(pa, pb) + e
    });
}

export function aabbSphere(center: d.v3f, radius: number, smoothness: number) {
    "use gpu";
    const r = d.vec3f(radius);
    return AABB({
        min: center - (r * d.f32(1) + smoothness),
        max: center + (r * d.f32(1) + smoothness)
    });
}

export function aabbCube(center: d.v3f, halfSize: number) {
    "use gpu";
    const e = d.vec3f(halfSize);
    return AABB({
        min: center - e,
        max: center + e
    });
}

export const Intersection = d.struct({
    near: d.f32,
    far: d.f32,
});

export function rayAABBIntersection(rayOrigin: d.v3f, rayDir: d.v3f, aabb: d.Infer<typeof AABB>) {
    "use gpu";

    const tMin = d.vec3f(
        (aabb.min.x - rayOrigin.x) / rayDir.x,
        (aabb.min.y - rayOrigin.y) / rayDir.y,
        (aabb.min.z - rayOrigin.z) / rayDir.z,
    );
    const tMax = d.vec3f(
        (aabb.max.x - rayOrigin.x) / rayDir.x,
        (aabb.max.y - rayOrigin.y) / rayDir.y,
        (aabb.max.z - rayOrigin.z) / rayDir.z,
    );

    const tNear = std.max(
        std.min(tMin.x, tMax.x),
        std.min(tMin.y, tMax.y),
        std.min(tMin.z, tMax.z),
    );
    const tFar = std.min(
        std.max(tMin.x, tMax.x),
        std.max(tMin.y, tMax.y),
        std.max(tMin.z, tMax.z),
    );

    if (tFar > 0 && tNear <= tFar) {
        return Intersection({
            near: std.max(tNear, 0),
            far: tFar,
        })
    }

    return Intersection({
        near: -1,
        far: -1,
    })
};

export function frustumIntersectsAABB(frustum: d.v4f[], aabb: Infer<typeof AABB>): boolean {
    for (let i = 0; i < frustum.length; i++) {

        const normal = frustum[i].xyz;
        const distance = frustum[i].w;

        // Find the p-vertex (vertex most in the direction of the plane normal)
        const px = normal.x >= 0 ? aabb.max.x : aabb.min.x;
        const py = normal.y >= 0 ? aabb.max.y : aabb.min.y;
        const pz = normal.z >= 0 ? aabb.max.z : aabb.min.z;

        // If the p-vertex is outside this plane, the AABB is completely outside
        const dist =
            normal.x * px +
            normal.y * py +
            normal.z * pz +
            distance;

        if (dist < 0) {
            return false;
        }
    };

    return true;
}