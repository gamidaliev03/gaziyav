// params[0] = (sigma, step, direction.x, direction.y)
fn effect(uv: vec2f) -> vec4f {
    let p = P0();
    let sigma = p.x;
    let step_size = p.y;
    let direction = p.zw;
    let texel_size = texel();

    var color = vec4f(0.0, 0.0, 0.0, 0.0);
    var total_weight = 0.0;
    for (var index = -30; index <= 30; index = index + 1) {
        let position = f32(index) * step_size;
        let weight = exp(-(position * position) / (2.0 * sigma * sigma));
        color = color + src(uv + texel_size * direction * position) * weight;
        total_weight = total_weight + weight;
    }
    return color / total_weight;
}
