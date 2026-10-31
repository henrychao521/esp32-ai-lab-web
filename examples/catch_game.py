# 左右鍵控制底盤接球小遊戲，漏接 3 次遊戲結束
from machine import Pin
import random

btn_l = Pin(0, Pin.IN, Pin.PULL_UP)
btn_r = Pin(47, Pin.IN, Pin.PULL_UP)

paddle_x = 48
ball_x = 64
ball_y = 10
ball_speed = 3
score = 0
misses = 0

while lab.running():
    # 讀取按鈕並移動接球盤
    if btn_l.value() == 0:
        paddle_x = max(0, paddle_x - 5)
    if btn_r.value() == 0:
        paddle_x = min(96, paddle_x + 5)
        
    if misses < 3:
        # 掉落小球
        ball_y += ball_speed
        
        # 檢查是否接住小球
        if ball_y >= 112:
            if paddle_x <= ball_x <= paddle_x + 32:
                score += 1
                ball_x = random.randint(10, 118)
                ball_y = 10
                print("Catch! Score:", score)
            else:
                misses += 1
                ball_x = random.randint(10, 118)
                ball_y = 10
                print("Missed! Total misses:", misses)
                
        # 繪製遊戲畫面
        lab.display.fill(lab.display.BLACK)
        lab.display.text("S:{} M:{}/3".format(score, misses), 8, 8, lab.display.WHITE)
        # 畫球
        lab.display.fill_rect(ball_x - 2, ball_y - 2, 5, 5, lab.display.YELLOW)
        # 畫底盤
        lab.display.fill_rect(paddle_x, 116, 32, 6, lab.display.CYAN)
    else:
        # 遊戲結束結算畫面
        lab.display.fill(lab.display.BLACK)
        lab.display.text("GAME OVER", 28, 40, lab.display.RED)
        lab.display.text("Score: {}".format(score), 32, 64, lab.display.YELLOW)
        lab.display.text("Restart Lab!", 16, 88, lab.display.WHITE)
        
    lab.display.show()
    lab.sleep(0.04)
