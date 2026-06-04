# sdf-scupltor

Uses **Signed Distance Function** to render smoothed-out geometry.

Implements **Tiled Frustum Culling** to optimize rendering.<br>
Camera's view is divided into tiles, each testing its intersections with all AABB's.<br>
Final image is constructed in Compute Shader (per tile).

Tiling and smoothing settings can be set in real-time.<br>
User can place spheres in cursor position.

Written in [TypeGPU](https://github.com/software-mansion/TypeGPU).