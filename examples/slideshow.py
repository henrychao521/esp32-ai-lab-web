# 每 2 秒自動輪播四種不同資訊畫面（時間、訊號、電池、幾何）
import time

page = 0
ticks = 0

while lab.running():
    lab.display.fill(lab.display.BLACK)
    
    # 繪製外框與頁碼標籤
    lab.display.rect(2, 2, 124, 124, lab.display.BLUE)
    lab.display.text("SLIDE {}/4".format(page + 1), 32, 10, lab.display.CYAN)
    
    if page == 0:
        # 頁面 1：系統時間
        t = time.localtime()
        s = "{:02d}:{:02d}:{:02d}".format(t[3], t[4], t[5])
        lab.display.text("LOCAL TIME", 24, 45, lab.display.WHITE)
        lab.display.text(s, 32, 70, lab.display.YELLOW)
    elif page == 1:
        # 頁面 2：無線訊號
        r = lab.rssi()
        s = "{} dBm".format(r) if r else "Offline"
        lab.display.text("WIFI STATUS", 20, 45, lab.display.WHITE)
        lab.display.text(s, 28, 70, lab.display.GREEN)
    elif page == 2:
        # 頁面 3：電池電壓
        b = lab.battery()
        s = "{:.2f} V".format(b) if b else "USB Power"
        lab.display.text("BATTERY", 36, 45, lab.display.WHITE)
        lab.display.text(s, 24, 70, lab.display.YELLOW)
    elif page == 3:
        # 頁面 4：幾何圖形展示
        lab.display.text("GEOMETRY", 32, 35, lab.display.WHITE)
        lab.display.rect(20, 55, 30, 30, lab.display.RED)
        lab.display.fill_rect(65, 55, 30, 30, lab.display.GREEN)
        lab.display.line(20, 105, 105, 105, lab.display.YELLOW)
        
    lab.display.show()
    
    # 每 2 秒（0.1s * 20 次）切換一頁
    ticks += 1
    if ticks >= 20:
        ticks = 0
        page = (page + 1) % 4
        print("Switched slide to page:", page)
        
    lab.sleep(0.1)
