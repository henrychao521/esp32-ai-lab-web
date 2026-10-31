# 讀取 GPIO16 光敏電阻類比值並繪製即時亮度光條
from machine import ADC, Pin

# 初始化 ADC（衰減設定為 11dB 可讀滿量程 0~3.3V）
ldr = None
try:
    ldr = ADC(Pin(16), atten=ADC.ATTN_11DB)
except Exception as e:
    print("ADC Init error:", e)

while lab.running():
    raw_val = 0
    if ldr is not None:
        try:
            raw_val = ldr.read_u16()
        except Exception as e:
            print("Read error:", e)
            
    # 換算為 0~100% 亮度比例
    pct = int(raw_val * 100 // 65535)
    lab.send(light=pct, raw_adc=raw_val)
    print("LDR light level:", pct, "% (ADC:", raw_val, ")")
    
    # 螢幕繪製
    lab.display.fill(lab.display.BLACK)
    lab.display.text("LIGHT SENSOR", 16, 14, lab.display.CYAN)
    lab.display.text("PIN: GPIO16", 20, 30, lab.display.WHITE)
    
    # 繪製量測外框與進度條
    lab.display.rect(14, 52, 100, 26, lab.display.WHITE)
    bar_w = int(96 * pct / 100)
    if bar_w > 0:
        lab.display.fill_rect(16, 54, bar_w, 22, lab.display.YELLOW)
        
    lab.display.text("{}% ({})".format(pct, raw_val), 18, 92, lab.display.GREEN)
    lab.display.show()
    lab.sleep(0.1)
