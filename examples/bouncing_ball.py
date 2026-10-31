# 模擬小球在螢幕邊界碰撞反彈的物理運動
x = 64
y = 64
vx = 3
vy = 2
radius = 5

while lab.running():
    # 移動小球位置
    x += vx
    y += vy
    
    # X 軸邊界碰撞檢測
    if x - radius <= 0:
        x = radius
        vx = -vx
    elif x + radius >= 127:
        x = 127 - radius
        vx = -vx
        
    # Y 軸邊界碰撞檢測
    if y - radius <= 0:
        y = radius
        vy = -vy
    elif y + radius >= 127:
        y = 127 - radius
        vy = -vy
        
    # 重新繪製畫面與小球
    lab.display.fill(lab.display.BLACK)
    lab.display.rect(0, 0, 128, 128, lab.display.BLUE)
    lab.display.fill_rect(int(x - radius), int(y - radius), radius * 2, radius * 2, lab.display.YELLOW)
    lab.display.text("BOUNCE", 40, 8, lab.display.CYAN)
    
    lab.display.show()
    lab.sleep(0.03)
