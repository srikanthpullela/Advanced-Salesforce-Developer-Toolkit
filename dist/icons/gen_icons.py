from PIL import Image, ImageDraw

def make_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = size / 128.0
    # Purple rounded square background
    r = int(28 * s)
    draw.rounded_rectangle([0, 0, size-1, size-1], radius=r, fill=(124, 110, 240, 255))
    # White lightning bolt
    bolt = [(int(73*s), int(24*s)), (int(42*s), int(72*s)), (int(62*s), int(72*s)),
            (int(54*s), int(108*s)), (int(96*s), int(58*s)), (int(74*s), int(58*s)), (int(82*s), int(24*s))]
    draw.polygon(bolt, fill=(255, 255, 255, 255))
    img.save(f'icon{size}.png')
    print(f'Generated icon{size}.png ({size}x{size})')

for size in [16, 48, 128]:
    make_icon(size)
