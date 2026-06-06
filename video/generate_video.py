"""
Promo Video Generator for Advanced Salesforce Developer Toolkit
Generates a slideshow video from Chrome Web Store screenshots with shortcut overlays.

Usage:
1. Place your 5 screenshots in the 'screenshots/' subfolder named:
   - 01_intro.png       (Salesforce Dev at Terminal Speed)
   - 02_search.png      (Find Anything in Your Org)
   - 03_inspector.png   (Every Field. Every Value. One Panel.)
   - 04_debug.png       (Debug Without Switching Tabs)
   - 05_soql.png        (SOQL Results in 42ms)

2. Run: python3 generate_video.py
3. Output: promo_video.mp4
"""

import os
import subprocess
from PIL import Image, ImageDraw, ImageFont

# Config
SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), 'screenshots')
OUTPUT_DIR = os.path.dirname(__file__)
FRAME_DIR = os.path.join(OUTPUT_DIR, 'frames')
VIDEO_WIDTH = 1920
VIDEO_HEIGHT = 1080
FPS = 30
SLIDE_DURATION = 4  # seconds per slide
FADE_DURATION = 0.5  # seconds for fade transition

# Slide config: (filename, shortcut_key, feature_name)
SLIDES = [
    ('01_intro.png', None, None),  # Title slide - no shortcut
    ('02_search.png', '⌘/Ctrl + Shift + P', 'Global Search'),
    ('03_inspector.png', '⌘/Ctrl + Shift + X', 'Object Inspector'),
    ('04_debug.png', '⌘/Ctrl + Shift + K', 'Debug Logs'),
    ('05_soql.png', '⌘/Ctrl + Shift + L', 'SOQL Query Editor'),
]

# Colors
BG_COLOR = (13, 17, 23)
BADGE_BG = (30, 35, 44, 220)
BADGE_TEXT = (255, 255, 255)
SHORTCUT_BG = (88, 166, 255, 230)
SHORTCUT_TEXT = (255, 255, 255)


def get_fonts():
    """Load fonts with fallbacks."""
    sizes = {'badge': 28, 'shortcut': 32, 'shortcut_sm': 22}
    fonts = {}
    for name, size in sizes.items():
        try:
            fonts[name] = ImageFont.truetype('/System/Library/Fonts/SFCompact.ttf', size)
        except:
            try:
                fonts[name] = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', size)
            except:
                fonts[name] = ImageFont.load_default()
    return fonts


def create_frame(slide_info, fonts):
    """Create a single 1920x1080 frame from a screenshot with shortcut overlay."""
    filename, shortcut, feature_name = slide_info
    filepath = os.path.join(SCREENSHOTS_DIR, filename)

    if not os.path.exists(filepath):
        print(f"  WARNING: {filepath} not found, creating placeholder")
        frame = Image.new('RGB', (VIDEO_WIDTH, VIDEO_HEIGHT), BG_COLOR)
        draw = ImageDraw.Draw(frame)
        draw.text((VIDEO_WIDTH // 2 - 200, VIDEO_HEIGHT // 2), f"Missing: {filename}",
                  fill=(255, 100, 100), font=fonts['badge'])
        return frame

    # Load and resize screenshot to fit 1920x1080
    screenshot = Image.open(filepath).convert('RGBA')
    orig_w, orig_h = screenshot.size

    # Scale to fit within video frame (maintain aspect ratio)
    scale = min(VIDEO_WIDTH / orig_w, VIDEO_HEIGHT / orig_h)
    new_w = int(orig_w * scale)
    new_h = int(orig_h * scale)
    screenshot = screenshot.resize((new_w, new_h), Image.LANCZOS)

    # Create frame with dark background
    frame = Image.new('RGBA', (VIDEO_WIDTH, VIDEO_HEIGHT), BG_COLOR + (255,))

    # Center the screenshot
    x_offset = (VIDEO_WIDTH - new_w) // 2
    y_offset = (VIDEO_HEIGHT - new_h) // 2
    frame.paste(screenshot, (x_offset, y_offset), screenshot)

    # Add shortcut badge at bottom center
    if shortcut:
        draw = ImageDraw.Draw(frame)

        # Shortcut pill badge
        badge_text = f"  {shortcut}  "
        bbox = draw.textbbox((0, 0), badge_text, font=fonts['shortcut'])
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

        pill_w = text_w + 40
        pill_h = text_h + 24
        pill_x = (VIDEO_WIDTH - pill_w) // 2
        pill_y = VIDEO_HEIGHT - 90

        # Draw pill background
        overlay = Image.new('RGBA', (VIDEO_WIDTH, VIDEO_HEIGHT), (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.rounded_rectangle(
            [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
            radius=pill_h // 2,
            fill=SHORTCUT_BG
        )
        frame = Image.alpha_composite(frame, overlay)
        draw = ImageDraw.Draw(frame)

        # Draw shortcut text
        draw.text((pill_x + 20, pill_y + 12), badge_text, fill=SHORTCUT_TEXT, font=fonts['shortcut'])

    return frame.convert('RGB')


def create_end_card(fonts):
    """Create an end card with install CTA."""
    frame = Image.new('RGB', (VIDEO_WIDTH, VIDEO_HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(frame)

    # Load logo
    logo_path = os.path.join(os.path.dirname(__file__), '..', 'icons', 'icon128.png')
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert('RGBA').resize((120, 120), Image.LANCZOS)
        frame_rgba = frame.convert('RGBA')
        frame_rgba.paste(logo, (VIDEO_WIDTH // 2 - 60, 320), logo)
        frame = frame_rgba.convert('RGB')
        draw = ImageDraw.Draw(frame)

    try:
        font_title = ImageFont.truetype('/System/Library/Fonts/SFCompact.ttf', 48)
        font_sub = ImageFont.truetype('/System/Library/Fonts/SFCompact.ttf', 28)
        font_url = ImageFont.truetype('/System/Library/Fonts/SFCompact.ttf', 22)
    except:
        font_title = fonts['shortcut']
        font_sub = fonts['badge']
        font_url = fonts['shortcut_sm']

    # Title
    title = "Advanced Salesforce Developer Toolkit"
    bbox = draw.textbbox((0, 0), title, font=font_title)
    tw = bbox[2] - bbox[0]
    draw.text(((VIDEO_WIDTH - tw) // 2, 480), title, fill=(255, 255, 255), font=font_title)

    # Subtitle
    sub = "Install free from Chrome Web Store"
    bbox = draw.textbbox((0, 0), sub, font=font_sub)
    sw = bbox[2] - bbox[0]
    draw.text(((VIDEO_WIDTH - sw) // 2, 560), sub, fill=(139, 148, 158), font=font_sub)

    # Shortcuts summary
    shortcuts = [
        "⌘/Ctrl + Shift + P  Search",
        "⌘/Ctrl + Shift + X  Inspector",
        "⌘/Ctrl + Shift + K  Debug Logs",
        "⌘/Ctrl + Shift + L  SOQL",
        "⌘/Ctrl + Shift + E  Execute Apex",
    ]
    y = 650
    for sc in shortcuts:
        bbox = draw.textbbox((0, 0), sc, font=font_url)
        scw = bbox[2] - bbox[0]
        draw.text(((VIDEO_WIDTH - scw) // 2, y), sc, fill=(88, 166, 255), font=font_url)
        y += 36

    return frame


def main():
    print("=== Promo Video Generator ===\n")

    # Check screenshots exist
    missing = []
    for filename, _, _ in SLIDES:
        path = os.path.join(SCREENSHOTS_DIR, filename)
        if not os.path.exists(path):
            missing.append(filename)

    if missing:
        print("Missing screenshots in 'screenshots/' folder:")
        for f in missing:
            print(f"  - {f}")
        print(f"\nPlease save your 5 screenshots as:")
        for filename, shortcut, feature in SLIDES:
            label = feature or "Intro/Title"
            print(f"  screenshots/{filename}  ({label})")
        print()
        resp = input("Continue anyway with available screenshots? (y/n): ")
        if resp.lower() != 'y':
            return

    # Create frames directory
    os.makedirs(FRAME_DIR, exist_ok=True)

    fonts = get_fonts()

    # Generate frames
    print("\nGenerating frames...")
    frame_files = []
    frame_idx = 0

    for i, slide_info in enumerate(SLIDES):
        print(f"  Slide {i + 1}: {slide_info[0]} ({slide_info[2] or 'Intro'})")
        frame = create_frame(slide_info, fonts)

        # Write multiple copies of same frame for duration (at FPS)
        frames_per_slide = FPS * SLIDE_DURATION
        for f in range(frames_per_slide):
            frame_path = os.path.join(FRAME_DIR, f'frame_{frame_idx:05d}.png')
            frame.save(frame_path, 'PNG')
            frame_files.append(frame_path)
            frame_idx += 1

    # End card (3 seconds)
    print("  End card...")
    end_frame = create_end_card(fonts)
    for f in range(FPS * 3):
        frame_path = os.path.join(FRAME_DIR, f'frame_{frame_idx:05d}.png')
        end_frame.save(frame_path, 'PNG')
        frame_files.append(frame_path)
        frame_idx += 1

    print(f"\n  Total frames: {frame_idx} ({frame_idx / FPS:.1f}s)")

    # Generate video with FFmpeg
    print("\nEncoding video with FFmpeg...")
    output_path = os.path.join(OUTPUT_DIR, 'promo_video.mp4')

    # Use xfade filter for smooth transitions between slides
    # First, create individual slide videos, then concatenate with transitions
    slide_videos = []
    frame_offset = 0

    for i, slide_info in enumerate(SLIDES):
        frames_per_slide = FPS * SLIDE_DURATION
        slide_path = os.path.join(FRAME_DIR, f'slide_{i}.mp4')
        start_frame = os.path.join(FRAME_DIR, f'frame_{frame_offset:05d}.png')

        cmd = [
            'ffmpeg', '-y',
            '-framerate', str(FPS),
            '-start_number', str(frame_offset),
            '-i', os.path.join(FRAME_DIR, 'frame_%05d.png'),
            '-frames:v', str(frames_per_slide),
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-preset', 'medium', '-crf', '18',
            slide_path
        ]
        subprocess.run(cmd, capture_output=True)
        slide_videos.append(slide_path)
        frame_offset += frames_per_slide

    # End card video
    end_path = os.path.join(FRAME_DIR, 'slide_end.mp4')
    cmd = [
        'ffmpeg', '-y',
        '-framerate', str(FPS),
        '-start_number', str(frame_offset),
        '-i', os.path.join(FRAME_DIR, 'frame_%05d.png'),
        '-frames:v', str(FPS * 3),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-preset', 'medium', '-crf', '18',
        end_path
    ]
    subprocess.run(cmd, capture_output=True)
    slide_videos.append(end_path)

    # Concatenate with xfade transitions
    if len(slide_videos) > 1:
        # Build complex filter for xfade
        inputs = []
        for sv in slide_videos:
            inputs.extend(['-i', sv])

        # Build xfade filter chain
        n = len(slide_videos)
        filter_parts = []
        offset = SLIDE_DURATION - FADE_DURATION

        # First transition
        filter_parts.append(f'[0:v][1:v]xfade=transition=fade:duration={FADE_DURATION}:offset={offset}[v1]')

        for i in range(2, n):
            prev = f'[v{i-1}]'
            curr_offset = offset + (SLIDE_DURATION - FADE_DURATION) * (i - 1) + FADE_DURATION * (i - 1)
            # Simpler: just accumulate
            curr_offset = offset + (SLIDE_DURATION - FADE_DURATION) * (i - 1)
            filter_parts.append(f'{prev}[{i}:v]xfade=transition=fade:duration={FADE_DURATION}:offset={curr_offset}[v{i}]')

        filter_complex = ';'.join(filter_parts)
        last_label = f'[v{n-1}]'

        cmd = ['ffmpeg', '-y'] + inputs + [
            '-filter_complex', filter_complex,
            '-map', last_label,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-preset', 'medium', '-crf', '18',
            output_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  xfade failed, falling back to simple concat...")
            # Fallback: simple concatenation
            concat_file = os.path.join(FRAME_DIR, 'concat.txt')
            with open(concat_file, 'w') as f:
                for sv in slide_videos:
                    f.write(f"file '{sv}'\n")

            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat', '-safe', '0',
                '-i', concat_file,
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-preset', 'medium', '-crf', '18',
                output_path
            ]
            subprocess.run(cmd, capture_output=True)

    print(f"\n✅ Video saved: {output_path}")
    print(f"   Duration: ~{len(SLIDES) * SLIDE_DURATION + 3}s")
    print(f"   Resolution: {VIDEO_WIDTH}x{VIDEO_HEIGHT}")
    print(f"\n   Upload to YouTube, then paste the URL in Chrome Web Store.")

    # Cleanup frames
    print("\nCleaning up temporary frames...")
    import shutil
    shutil.rmtree(FRAME_DIR, ignore_errors=True)
    print("Done!")


if __name__ == '__main__':
    main()
