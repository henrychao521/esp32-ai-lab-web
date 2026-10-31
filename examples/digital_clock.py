# NTP 網路校時並在螢幕顯示台灣時間電子鐘
import time
import ntptime

# 嘗試同步網路時間
lab.display.fill(lab.display.BLACK)
lab.display.text("Syncing NTP...", 12, 56, lab.display.CYAN)
lab.display.show()

try:
    ntptime.settime()
    print("NTP sync successful")
except Exception as e:
    print("NTP sync failed:", e)

colon_show = True

while lab.running():
    # 加上台灣時區偏移量 (+8 小時 = 28800 秒)
    t = time.localtime(time.time() + 8 * 3600)
    hh = "{:02d}".format(t[3])
    mm = "{:02d}".format(t[4])
    ss = "{:02d}".format(t[5])
    
    # 冒號每秒閃爍
    sep = ":" if colon_show else " "
    colon_show = not colon_show
    
    time_str = hh + sep + mm + sep + ss
    date_str = "{:04d}-{:02d}-{:02d}".format(t[0], t[1], t[2])
    
    lab.display.fill(lab.display.BLACK)
    lab.display.rect(4, 4, 120, 120, lab.display.WHITE)
    lab.display.text("TAIWAN TIME", 20, 24, lab.display.CYAN)
    lab.display.text(time_str, 28, 56, lab.display.YELLOW)
    lab.display.text(date_str, 24, 88, lab.display.GREEN)
    lab.display.show()
    
    lab.sleep(0.5)
