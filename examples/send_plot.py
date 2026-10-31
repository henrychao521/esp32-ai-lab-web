# 每 0.2 秒送出正弦波數值並在螢幕上繪製滾動折線圖
import math

angle = 0.0
history = [64] * 128

while lab.running():
    # 計算正弦波數值（-1.0 ~ 1.0）並對應至螢幕 Y 座標
    val = math.sin(angle)
    y = int(64 - val * 35)
    
    # 滾動歷史資料佇列
    history.pop(0)
    history.append(y)
    
    # 送出感測值供前端圖表繪製
    lab.send(wave=val)
    
    # 繪製畫面
    lab.display.fill(lab.display.BLACK)
    lab.display.text("SINE WAVE", 28, 8, lab.display.CYAN)
    lab.display.hline(0, 64, 128, lab.display.BLUE)
    
    # 連接相鄰點畫出波形折線
    for i in range(127):
        lab.display.line(i, history[i], i + 1, history[i + 1], lab.display.GREEN)
        
    lab.display.text("Val: {:.2f}".format(val), 28, 110, lab.display.YELLOW)
    lab.display.show()
    
    angle += 0.25
    lab.sleep(0.05)
