from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
import os, json

os.makedirs("samples", exist_ok=True)

RFQ1 = """REQUEST FOR QUOTATION

Customer: Voltmark Elektrotechnik GmbH
Project: Halle 4 - Unterverteilung
Date: 09.09.2026
Please quote the following items.

Pos.  Item code            Description                                    Qty     Unit
1.    CBL-NYY-J-5G2.5      Power cable NYY-J 5G2.5 mm2 black              250     m
2.    CBL-NYM-J-3G1.5      Installation cable NYM-J 3G1.5 grey            1.200   m
3.    MCB-B16-3P           Miniature circuit breaker B16 3-pole           24      pcs
4.    RCD-40-4P-30         RCD 40A 4-pole 30mA type A                     6       pcs
5.    CON-12A-230          Contactor 12A 3-pole coil 230VAC               12      pcs
6.    ENC-IP65-400         Wall enclosure IP65 400x300x200                4       pcs
7.    DIN-RAIL-35          DIN rail TS35 perforated 2m                    18      pcs
8.    CGL-M25              Cable gland M25 IP68                           120     pcs
9.    LED-PAN-600-40       LED panel 600x600 40W 4000K                    36      pcs
10.   PSU-24-5             DIN rail power supply 24VDC 5A                 3       pcs

Delivery: Vienna, 10/2026
Thank you.
"""

RFQ2 = """QUOTATION REQUEST - Nordlicht Anlagenbau

Pos.  Article               Description                                    Qty     Unit
1.    cbl nyy j 5g4         Power cable NYY-J 5G4 mm2                      180     m
2.    MCB-B16-1P            MCB B16 1-pole 6kA                             40      pcs
3.    MCB-B16-3B            Miniature circuit breaker B16 3-pole 6kA       10      pcs
4.    SOC-CEE-32-5P         CEE socket 32A 5-pole 400V IP44                8       pcs
5.    OLR-9-13              Thermal overload relay 9-13A                   6       pcs
6.    TB-2.5-GY             Terminal block screw 2.5mm2 grey               400     pcs
7.    SPD-T2-4P             Surge protection device type 2 4-pole          2       pcs
8.    ML-CU-12X2            Copper busbar 12x2mm                           14      m
9.    FLT-EMC-3P-16         EMC line filter 3-phase 16A                    2       pcs
10.   LED-BAT-1500-50       LED batten 1500mm 50W IP65                     22      pcs

Please include lead times.
"""

RFQ3 = """Hello,

we need a quotation for the following material for a small workshop fit-out.
No item numbers on our side, sorry - descriptions only.

- 320 m installation cable NYM-J 5G2.5 mm2 grey
- 45 pcs surface Schuko socket 16A IP44 grey
- 30 pcs surface switch 1-pole 10A IP44 grey
- 8 pcs residual current device 63A 4-pole 30mA type A
- 16 pcs miniature circuit breaker B16
- 12 pcs wall enclosure IP66 600x400x200 grey
- 200 pcs cable gland M20 IP68 plastic grey
- 60 m single core H07V-K 1x10 mm2 black
- 5 pcs current transformer 100/5A class 1
- 20 pcs LED panel 600x600 30W 4000K UGR19
- 90 pcs terminal block screw 4mm2 grey
- 3 pcs cable drum trolley, steel, 400mm

Best regards
Rita Hollenbach
"""

def render(path, text, mono=True):
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont("Courier" if mono else "Helvetica", 8.6)
    w, h = A4
    y = h - 22*mm
    for line in text.split("\n"):
        if y < 20*mm:
            c.showPage(); c.setFont("Courier" if mono else "Helvetica", 8.6); y = h - 22*mm
        c.drawString(16*mm, y, line)
        y -= 4.3*mm
    c.save()

render("samples/rfq_01_voltmark.pdf", RFQ1)
render("samples/rfq_02_nordlicht.pdf", RFQ2)
render("samples/rfq_03_workshop.pdf", RFQ3, mono=False)
print("written")
