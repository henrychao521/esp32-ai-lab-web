# 每 0.5 秒切換一次 LED 狀態並記錄閃爍次數
state = 0
times = 0

while lab.running():
    # 切換狀態（0 變 1，1 變 0）
    state = 1 - state
    lab.led(state)
    times += 1
    
    # 清除螢幕並顯示目前狀態文字
    lab.display.fill(lab.display.BLACK)
    lab.display.text("LED BLINK", 28, 40, lab.display.GREEN)
    status_text = "STATE: ON" if state == 1 else "STATE: OFF"
    lab.display.text(status_text, 24, 60, lab.display.WHITE)
    lab.display.text("Times: " + str(times), 24, 80, lab.display.YELLOW)
    lab.display.show()
    
    # 輸出到學生主控台
    print("LED state:", state, "Total toggles:", times)
    lab.sleep(0.5)
