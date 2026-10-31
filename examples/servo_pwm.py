# 透過滑桿 s1 控制 GPIO17 伺服馬達並在螢幕顯示儀表指針
from machine import Pin, PWM
import math

# 初始化 GPIO17 PWM 50Hz (週期 20ms)
servo = None
try:
    servo = PWM(Pin(17), freq=50)
except Exception as e:
    print("PWM error:", e)

target_angle = 90

@lab.on_cmd
def on_cmd(cmd):
    global target_angle
    if cmd.get("op") == "slider" and cmd.get("id") == "s1":
        # 將 0~100 滑桿映射到 0~180 度
        val = int(cmd.get("v", 50))
        target_angle = int(val * 180 / 100)
        print("Servo target angle:", target_angle)

while lab.running():
    # 角度 0~180 度對應 duty_u16 約 1638 ~ 8192
    duty = int(1638 + (target_angle / 180) * (8192 - 1638))
    if servo is not None:
        servo.duty_u16(duty)
        
    # 螢幕儀表板繪製
    lab.display.fill(lab.display.BLACK)
    lab.display.text("SERVO MONITOR", 12, 10, lab.display.CYAN)
    lab.display.text("Angle: {} deg".format(target_angle), 14, 28, lab.display.YELLOW)
    
    # 繪製半圓形刻度盤與指針
    cx, cy = 64, 95
    lab.display.rect(14, 50, 100, 56, lab.display.BLUE)
    rad = math.radians(180 - target_angle)
    px = int(cx + 36 * math.cos(rad))
    py = int(cy - 36 * math.sin(rad))
    lab.display.line(cx, cy, px, py, lab.display.RED)
    lab.display.fill_rect(cx - 2, cy - 2, 5, 5, lab.display.WHITE)
    
    lab.display.show()
    lab.sleep(0.05)
