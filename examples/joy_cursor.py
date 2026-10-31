# 接收遠端搖桿控制游標移動，按 A 鍵清除軌跡
cx = 60.0
cy = 60.0
vx = 0.0
vy = 0.0

@lab.on_cmd
def on_cmd(cmd):
    global vx, vy, cx, cy
    op = cmd.get("op")
    if op == "joy":
        # 搖桿輸入 x, y 介於 -1.0 ~ 1.0 (y 向下為正)
        vx = float(cmd.get("x", 0.0)) * 4.0
        vy = float(cmd.get("y", 0.0)) * 4.0
    elif op == "btn":
        # 按下 A 鍵重置回中央
        if cmd.get("id") == "A" and cmd.get("v") == 1:
            cx, cy = 60.0, 60.0
            vx, vy = 0.0, 0.0
            print("Reset cursor position")

while lab.running():
    # 更新游標位置並限制在螢幕內
    cx = max(4.0, min(116.0, cx + vx))
    cy = max(4.0, min(116.0, cy + vy))
    
    lab.display.fill(lab.display.BLACK)
    lab.display.rect(0, 0, 128, 128, lab.display.BLUE)
    lab.display.text("JOYSTICK", 32, 10, lab.display.CYAN)
    
    # 繪製游標十字與中心方塊
    ix, iy = int(cx), int(cy)
    lab.display.fill_rect(ix - 4, iy - 4, 8, 8, lab.display.YELLOW)
    lab.display.line(ix - 8, iy, ix + 8, iy, lab.display.RED)
    lab.display.line(ix, iy - 8, ix, iy + 8, lab.display.RED)
    
    lab.display.text("X:{} Y:{}".format(ix, iy), 24, 110, lab.display.WHITE)
    lab.display.show()
    lab.sleep(0.04)
