# 透過 HSV 演算法在螢幕繪製平滑流動的彩虹漸層
def hsv_to_rgb565(h, s, v):
    # h: 0~359, s: 0~100, v: 0~100 -> 回傳 RGB565 整數
    hi = (h // 60) % 6
    f = (h % 60) * 1000 // 60
    p = v * (100 - s) // 100
    q = v * (100000 - s * f) // 100000
    t = v * (100000 - s * (1000 - f)) // 100000
    
    if hi == 0: r, g, b = v, t, p
    elif hi == 1: r, g, b = q, v, p
    elif hi == 2: r, g, b = p, v, t
    elif hi == 3: r, g, b = p, q, v
    elif hi == 4: r, g, b = t, p, v
    else: r, g, b = v, p, q
    
    # 轉換為 5-6-5 格式 (0~255 轉成 5bit, 6bit, 5bit)
    r5 = (r * 31) // 100
    g6 = (g * 63) // 100
    b5 = (b * 31) // 100
    return (r5 << 11) | (g6 << 5) | b5

hue_offset = 0

while lab.running():
    # 繪製 16 條垂直漸層色塊以提高繪製效率
    for col in range(16):
        h = (hue_offset + col * 22) % 360
        color_val = hsv_to_rgb565(h, 100, 100)
        lab.display.fill_rect(col * 8, 0, 8, 128, color_val)
        
    # 螢幕中央加上文字標籤
    lab.display.fill_rect(18, 52, 92, 24, lab.display.BLACK)
    lab.display.text("RAINBOW", 36, 60, lab.display.WHITE)
    lab.display.show()
    
    hue_offset = (hue_offset + 8) % 360
    lab.sleep(0.05)
