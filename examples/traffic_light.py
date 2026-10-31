# 有限狀態機控制紅綠燈迴圈，右鍵為行人過馬路優先按鈕
from machine import Pin

# 右鍵作為行人請求按鈕
btn_ped = Pin(47, Pin.IN, Pin.PULL_UP)

# 狀態定義：RED (紅燈 3s), GREEN (綠燈 3s), YELLOW (黃燈 1s)
state = "RED"
timer = 3.0
ped_requested = False

while lab.running():
    # 檢查行人按鈕（按下為 0）
    if btn_ped.value() == 0 and not ped_requested:
        ped_requested = True
        print("Pedestrian button pressed!")
        # 若目前為綠燈且剩餘時間大於 1 秒，提早進入黃燈
        if state == "GREEN" and timer > 1.0:
            timer = 1.0
            
    # 狀態轉換計時
    timer -= 0.1
    if timer <= 0:
        if state == "RED":
            state = "GREEN"
            timer = 3.0
            ped_requested = False
        elif state == "GREEN":
            state = "YELLOW"
            timer = 1.0
        elif state == "YELLOW":
            state = "RED"
            timer = 3.0
        print("Light changed to:", state)
        
    # 繪製紅綠燈箱與號誌燈
    lab.display.fill(lab.display.BLACK)
    lab.display.rect(44, 14, 40, 100, lab.display.WHITE)
    
    c_red = lab.display.RED if state == "RED" else lab.display.BLACK
    c_yel = lab.display.YELLOW if state == "YELLOW" else lab.display.BLACK
    c_grn = lab.display.GREEN if state == "GREEN" else lab.display.BLACK
    
    lab.display.fill_rect(52, 22, 24, 24, c_red)
    lab.display.fill_rect(52, 52, 24, 24, c_yel)
    lab.display.fill_rect(52, 82, 24, 24, c_grn)
    
    # 顯示行人請求狀態提示
    if ped_requested:
        lab.display.text("WAIT", 48, 2, lab.display.YELLOW)
        
    lab.display.show()
    lab.sleep(0.1)
