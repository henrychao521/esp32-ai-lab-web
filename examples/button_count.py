# 左右實體按鍵獨立計數並在螢幕顯示
from machine import Pin

# 初始化左右按鍵（T-QT Pro：左鍵 GPIO0，右鍵 GPIO47，上拉電阻，按下為 0）
btn_l = Pin(0, Pin.IN, Pin.PULL_UP)
btn_r = Pin(47, Pin.IN, Pin.PULL_UP)

count_l = 0
count_r = 0
last_l = 1
last_r = 1

while lab.running():
    val_l = btn_l.value()
    val_r = btn_r.value()
    
    # 偵測按下瞬間（前次為 1 且本次為 0）
    if last_l == 1 and val_l == 0:
        count_l += 1
        lab.send(left_clicks=count_l)
        print("Left pressed! Total:", count_l)
        
    if last_r == 1 and val_r == 0:
        count_r += 1
        lab.send(right_clicks=count_r)
        print("Right pressed! Total:", count_r)
        
    last_l = val_l
    last_r = val_r
    
    # 繪製畫面
    lab.display.fill(lab.display.BLACK)
    lab.display.text("BUTTON COUNTER", 10, 16, lab.display.WHITE)
    
    # 左鍵顯示方塊
    c_l = lab.display.GREEN if val_l == 0 else lab.display.BLUE
    lab.display.fill_rect(10, 40, 50, 60, c_l)
    lab.display.text("LEFT", 18, 48, lab.display.WHITE)
    lab.display.text(str(count_l), 28, 72, lab.display.YELLOW)
    
    # 右鍵顯示方塊
    c_r = lab.display.GREEN if val_r == 0 else lab.display.BLUE
    lab.display.fill_rect(68, 40, 50, 60, c_r)
    lab.display.text("RIGHT", 72, 48, lab.display.WHITE)
    lab.display.text(str(count_r), 86, 72, lab.display.YELLOW)
    
    lab.display.show()
    lab.sleep(0.05)
