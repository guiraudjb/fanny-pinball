' ---------------------------------------------------------------- règles : COFFRE-FORT
'   Les trois cibles tombantes devant l'alcôve : CHRONO. La valeur du coffre part de 50 000 (+25 000 à chaque
'   coffre pris) et fond de 1 000 toutes les 0,4 s jusqu'à 5 000 ; au bout, les cibles se relèvent.
'   Bille dans le coffre pendant le chrono : la valeur restante. Couloir droit : +5 s ; tourniquet x5 pendant le chrono.
'   Rampe : la bille entre dans le verrou (rendue aussitôt) ; 2 verrous = MULTIBALL (3 billes) ; en multiball,
'   la rampe vaut JACKPOT (25 000) et le coffre double. Cibles de gauche (les deux) : KICKBACK.
'   Couloirs du haut 1-2-3-4 (décalés par les palettes) : bonus x2 … x5.
Const CHRONO_PAS_MS = 400, CHRONO_MIN = 5000
Dim couloirs(3), portes(2), ck(1), chronoActif, valeur, base, verrous, kickbackAllume, finChrono

Sub R_Partie() : base = 50000 : End Sub

Sub R_Bille()
  Dim i
  For i = 0 To 3 : couloirs(i) = False : Next
  For i = 0 To 2 : portes(i) = False : Next
  ck(0) = False : ck(1) = False
  chronoActif = False : verrous = 0
  AllumerKickback (bille = 1)
End Sub

Sub AllumerKickback(oui)
  kickbackAllume = oui
  Kickback.Enabled = oui
End Sub

Sub R_FinMultiball() : Say "FIN DU MULTIBALL", 1500 : verrous = 0 : End Sub
Function R_Info()
  If chronoActif Then R_Info = "COFFRE " & valeur Else R_Info = ""
End Function
Function R_Etat() : R_Etat = "chrono=" & chronoActif & " valeur=" & valeur & " base=" & base & " verrous=" & verrous & " kickback=" & kickbackAllume & " mult=" & mult : End Function

Sub R_Palette(sens)
  Dim a
  If sens < 0 Then
    a = couloirs(0) : couloirs(0) = couloirs(1) : couloirs(1) = couloirs(2) : couloirs(2) = couloirs(3) : couloirs(3) = a
  Else
    a = couloirs(3) : couloirs(3) = couloirs(2) : couloirs(2) = couloirs(1) : couloirs(1) = couloirs(0) : couloirs(0) = a
  End If
End Sub

Sub R_Lampes()
  Dim i
  For i = 0 To 3 : lampe(LP_haut0 + i) = B2E(couloirs(i)) : Next
  For i = 0 To 2 : lampe(LP_porte0 + i) = B2E(portes(i)) : Next
  lampe(LP_ck0) = B2E(ck(0)) : lampe(LP_ck1) = B2E(ck(1))
  If chronoActif Then lampe(LP_coffre) = 2 : lampe(LP_chrono) = 2 : lampe(LP_couloird) = 2
  If multiball Then lampe(LP_rampe) = 2 Else lampe(LP_rampe) = B2E(verrous = 1)
  lampe(LP_verrou0) = B2E(verrous >= 1) : lampe(LP_verrou1) = B2E(verrous >= 2 Or multiball)
  lampe(LP_kickback) = B2E(kickbackAllume)
  lampe(LP_extra) = B2E(extraBalls > 0)
  For i = 2 To 5 : lampe(LP_x2 + i - 2) = B2E(mult >= i) : Next
  If maintenant < ballSaveUntil Then lampe(LP_sauve) = 2
End Sub

Sub Regle(nom)
  Select Case nom
    Case "Bumper1", "Bumper2" : Ajouter 100, 0 : Son "bumper"
    Case "LanceG", "LanceD" : Ajouter 10, 0 : Son "lance_pierre"
    Case "SortieG", "SortieD" : Ajouter 1000, 1000 : Son "couloir"
    Case "RetourG", "RetourD" : Ajouter 500, 500 : Son "couloir"
    Case "Haut1" : Couloir 0
    Case "Haut2" : Couloir 1
    Case "Haut3" : Couloir 2
    Case "Haut4" : Couloir 3
    Case "Porte1" : Porte 0
    Case "Porte2" : Porte 1
    Case "Porte3" : Porte 2
    Case "CibleK1" : CibleK 0
    Case "CibleK2" : CibleK 1
    Case "Coffre" : AuCoffre
    Case "CouloirDroit"
      Ajouter 3000, 1000 : Son "couloir"
      If chronoActif Then finChrono = finChrono + 5000 : Say "+5 SECONDES", 1200
    Case "Tourniquet" : Ajouter 100 * IIf(chronoActif, 5, 1), 10 : Son "tourniquet"
    Case "CapteurRampe" : Son "rampe" : Ajouter 2500, 1000
    Case "Verrou" : AuVerrou
    Case "Kickback"
      Son "ejection" : Ajouter 2500, 0 : Say "KICKBACK", 1200
      Kickback.Kick 0, 42
      AllumerKickback False
  End Select
End Sub

Sub Couloir(i)
  Dim k
  Ajouter 500, 1000 : Son "couloir"
  couloirs(i) = True
  For k = 0 To 3 : If Not couloirs(k) Then Exit Sub
  Next
  For k = 0 To 3 : couloirs(k) = False : Next
  Son "couloirs_faits" : MultBonus
End Sub

Sub Porte(i)
  If portes(i) Then Exit Sub
  portes(i) = True
  Ajouter 1000, 1000 : Son "tombante"
  If portes(0) And portes(1) And portes(2) And Not chronoActif Then
    chronoActif = True : valeur = base : finChrono = maintenant + 20000
    Son "mode" : Say "CHRONO", 2000
    Apres CHRONO_PAS_MS, "Chrono"
  End If
End Sub

Sub Chrono()
  If Not chronoActif Then Exit Sub
  If mode <> "play" Or tilted Then chronoActif = False : Exit Sub
  If valeur > CHRONO_MIN Then valeur = valeur - 1000 : If valeur Mod 5000 = 0 Then Son "chrono"
  If maintenant > finChrono Then
    chronoActif = False : Say "TROP TARD", 1500 : FermerPorte : Exit Sub
  End If
  Apres CHRONO_PAS_MS, "Chrono"
End Sub

Sub FermerPorte()
  Remonter Array(Porte1, Porte2, Porte3)
  portes(0) = False : portes(1) = False : portes(2) = False
End Sub

Sub AuCoffre()
  Son "trou"
  If chronoActif Then
    chronoActif = False
    Ajouter valeur * IIf(multiball, 2, 1), 10000
    Say "COFFRE " & valeur * IIf(multiball, 2, 1), 2500 : Son "jackpot"
    base = base + 25000
  ElseIf extraLit Then
    DonnerExtra
  Else
    Ajouter 2000, 1000
  End If
  Ejecter "Coffre", 1200
  Apres 3500, "FermerPorte"                  ' la bille est sortie de l'alcôve
End Sub

Sub AuVerrou()
  Son "trou"
  If multiball Then
    Ajouter 25000, 0 : Say "JACKPOT 25000", 2000 : Son "jackpot"
  Else
    verrous = verrous + 1
    If verrous >= 2 Then
      Say "MULTIBALL", 3000 : LancerMultiball 3
    Else
      Say "BILLE VERROUILLEE", 2000 : Ajouter 5000, 2000
    End If
  End If
  Ejecter "Verrou", 1000
End Sub

Sub CibleK(i)
  Ajouter 1000, 1000 : Son "cible"
  ck(i) = True
  If ck(0) And ck(1) Then
    ck(0) = False : ck(1) = False
    If Not kickbackAllume Then AllumerKickback True : Say "KICKBACK ALLUME", 2000
  End If
End Sub

Dim SCENARIO : SCENARIO = Array("Bumper1", "Haut1", "Haut2", "Haut3", "Haut4", "Porte1", "Porte2", "Porte3", _
  "Tourniquet", "CouloirDroit", "Coffre", "CapteurRampe", "Verrou", "CapteurRampe", "Verrou", "Verrou", _
  "CibleK1", "CibleK2", "Porte1", "Porte2", "Porte3", "Coffre", "SortieG")
