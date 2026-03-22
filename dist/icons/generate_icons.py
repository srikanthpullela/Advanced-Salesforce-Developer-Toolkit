import struct, zlib

def create_png(width, height, bg_r, bg_g, bg_b):
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            cx, cy = width // 2, height // 2
            dist = max(abs(x - cx), abs(y - cy))
            if dist < width // 2 - 1:
                raw += bytes([bg_r, bg_g, bg_b, 255])
            else:
                raw += bytes([0, 0, 0, 0])

    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

for size in [16, 48, 128]:
    png = create_png(size, size, 137, 180, 250)
    with open(f'icon{size}.png', 'wb') as f:
        f.write(png)
    print(f'Created icon{size}.png ({len(png)} bytes)')
