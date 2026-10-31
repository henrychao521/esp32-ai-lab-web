# 螢幕顯示 Hello 訊息與累加計數器
count = 0

while lab.running():
    # 清除畫面為黑色
    lab.display.fill(lab.display.BLACK)
    
    # 繪製標題與計數值（英數字型，不支援中文）
    lab.display.text("HELLO WORLD!", 16, 30, lab.display.CYAN)
    lab.display.text("ESP32 AI Lab", 16, 50, lab.display.WHITE)
    lab.display.text("Count: " + str(count), 16, 75, lab.display.YELLOW)
    
    # 畫出外框裝飾
    lab.display.rect(8, 15, 112, 98, lab.display.BLUE)
    
    # 刷新螢幕並在主控台輸出
    lab.display.show()
    print("Current count:", count)
    
    count += 1
    lab.sleep(1)
