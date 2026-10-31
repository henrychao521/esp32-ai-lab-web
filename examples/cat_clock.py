# 貓咪時鐘（T-QT Pro，esp32-ai-lab 版）
# 板子已由代理程式連好 Wi-Fi、初始化好螢幕，程式只管畫圖；用 lab.sleep 才能被「停止」鍵中斷。
import lab, time, ntptime
from lab.board_tqt import color

d = lab.display
BG, ORANGE, PINK = color(20, 24, 35), color(245, 145, 45), color(255, 175, 190)
WHITE, BLACK, CYAN = d.WHITE, d.BLACK, d.CYAN

try:
    ntptime.settime()            # Wi-Fi 已連好，直接校時（UTC）
    lab.log("NTP 校時完成")
except Exception as e:
    lab.log("NTP 失敗：", e)

def draw_cat(x, y, blink=False):
    d.fill_rect(x + 10, y + 2, 14, 18, ORANGE); d.fill_rect(x + 13, y + 5, 8, 12, PINK)
    d.fill_rect(x + 56, y + 2, 14, 18, ORANGE); d.fill_rect(x + 59, y + 5, 8, 12, PINK)
    d.fill_rect(x, y + 16, 80, 46, ORANGE); d.rect(x, y + 16, 80, 46, BLACK)
    if blink:
        d.hline(x + 18, y + 34, 14, BLACK); d.hline(x + 48, y + 34, 14, BLACK)
    else:
        d.fill_rect(x + 18, y + 28, 14, 12, WHITE); d.fill_rect(x + 48, y + 28, 14, 12, WHITE)
        d.fill_rect(x + 24, y + 30, 6, 8, BLACK);   d.fill_rect(x + 54, y + 30, 6, 8, BLACK)
    d.fill_rect(x + 38, y + 42, 4, 3, PINK); d.vline(x + 40, y + 45, 4, BLACK); d.hline(x + 35, y + 49, 11, BLACK)
    for dy in (37, 43):
        d.hline(x + 4, y + dy, 10, BLACK); d.hline(x + 66, y + dy, 10, BLACK)

while lab.running():                       # 不用 while True，才停得下來
    t = time.localtime(time.time() + 8 * 3600)   # 台灣 UTC+8
    d.fill(BG)
    draw_cat(24, 12, blink=(t[5] % 5 == 0))
    d.text("{:04d}/{:02d}/{:02d}".format(t[0], t[1], t[2]), 24, 82, CYAN)
    d.text("{:02d}:{:02d}:{:02d}".format(t[3], t[4], t[5]), 32, 98, WHITE)
    d.text("Wi-Fi: OK", 28, 114, CYAN)
    d.show()                                # 一定要 show 才會顯示
    lab.sleep(1)
