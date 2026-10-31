# 透過網頁滑桿 s1 調整背景亮度、s2 調整方塊尺寸
from lab.board_tqt import color

val_s1 = 50
val_s2 = 30

@lab.on_cmd
def on_cmd(cmd):
    global val_s1, val_s2
    if cmd.get("op") == "slider":
        sid = cmd.get("id")
        val = int(cmd.get("v", 0))
        if sid == "s1":
            val_s1 = max(0, min(100, val))
        elif sid == "s2":
            val_s2 = max(5, min(60, val))
        print("Slider updated:", sid, "->", val)

while lab.running():
    # s1 控制背景灰階顏色 (0~255)
    gray = int(val_s1 * 255 // 100)
    bg_col = color(gray, gray, gray)
    lab.display.fill(bg_col)
    
    # s2 控制中央方塊大小
    size = val_s2
    px = 64 - size // 2
    py = 64 - size // 2
    
    # 繪製方塊與反色文字
    text_col = lab.display.BLACK if gray > 128 else lab.display.WHITE
    box_col = lab.display.CYAN if gray > 128 else lab.display.YELLOW
    lab.display.fill_rect(px, py, size, size, box_col)
    lab.display.rect(px, py, size, size, lab.display.RED)
    
    lab.display.text("S1:{}".format(val_s1), 8, 8, text_col)
    lab.display.text("S2:{}".format(val_s2), 8, 20, text_col)
    lab.display.show()
    lab.sleep(0.05)
