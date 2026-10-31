# 根據鏡頭人臉座標帶動螢幕準心跟隨，無人臉時平滑回正
target_x = 64.0
target_y = 64.0
cur_x = 64.0
cur_y = 64.0
has_face = False

@lab.on_cmd
def on_cmd(cmd):
    global target_x, target_y, has_face
    if cmd.get("op") == "vision" and cmd.get("mode") == "face":
        box = cmd.get("box", [])
        if len(box) >= 4:
            # box 為 [x, y, w, h] 0.0~1.0 正規化座標
            fx = box[0] + box[2] / 2.0
            fy = box[1] + box[3] / 2.0
            # 鏡頭水平鏡像轉換符合直覺
            target_x = (1.0 - fx) * 128.0
            target_y = fy * 128.0
            has_face = True
            return
    has_face = False
    target_x = 64.0
    target_y = 64.0

while lab.running():
    # 內插平滑逼近目標位置
    cur_x += (target_x - cur_x) * 0.3
    cur_y += (target_y - cur_y) * 0.3
    
    lab.display.fill(lab.display.BLACK)
    lab.display.text("FACE TRACKER", 16, 8, lab.display.CYAN)
    
    ix, iy = int(cur_x), int(cur_y)
    box_c = lab.display.GREEN if has_face else lab.display.BLUE
    
    # 繪製瞄準鎖定框與準星十字線
    lab.display.rect(ix - 16, iy - 16, 32, 32, box_c)
    lab.display.line(ix - 24, iy, ix + 24, iy, box_c)
    lab.display.line(ix, iy - 24, ix, iy + 24, box_c)
    
    status = "TRACKING" if has_face else "SEARCHING"
    lab.display.text(status, 28, 110, lab.display.YELLOW if has_face else lab.display.WHITE)
    lab.display.show()
    lab.sleep(0.04)
