' ---------------------------------------------------------------- règles : BANQUES
'   Banque du centre (3 cibles tombantes) : ouvre le COFFRE. COFFRE ouvert : 10 000 × banques tombées dans la partie.
'   Les deux banques tombées sur la même bille : MULTIBALL (3 billes) allumé au COFFRE.
'   Multiball : RAMPE = JACKPOT (25 000, +5 000 à chaque fois), cibles tombantes doublées.
'   3 rampes : EXTRA BALL allumée au COFFRE. A-B-C (couloirs du haut, décalés par les palettes) : bonus ×2 … ×5.
'   Cibles debout du haut : les deux = COFFRE ouvert.
Dim couloirs(2), centre(2), droite(4), ciblesH(1)
Dim coffreOuvert, mbAllume, centreFait, droiteFait, banques, rampes, jackpot

Sub R_Partie()
  banques = 0 : rampes = 0 : jackpot = 25000
End Sub

Sub R_Bille()
  Dim i
  For i = 0 To 2 : couloirs(i) = False : centre(i) = False : Next
  For i = 0 To 4 : droite(i) = False : Next
  ciblesH(0) = False : ciblesH(1) = False
  coffreOuvert = False : mbAllume = False : centreFait = False : droiteFait = False
End Sub

Sub R_FinMultiball()
  Say "FIN DU MULTIBALL", 1500
  Remonter Array(Centre1, Centre2, Centre3, Droite1, Droite2, Droite3, Droite4, Droite5)
  Dim i
  For i = 0 To 2 : centre(i) = False : Next
  For i = 0 To 4 : droite(i) = False : Next
End Sub

Function R_Info() : R_Info = "" : End Function
Function R_Etat() : R_Etat = "coffre=" & coffreOuvert & " mb=" & mbAllume & " banques=" & banques & " rampes=" & rampes & " jackpot=" & jackpot & " extra=" & extraLit & " mult=" & mult : End Function

Sub R_Palette(sens)
  Dim a
  If sens < 0 Then
    a = couloirs(0) : couloirs(0) = couloirs(1) : couloirs(1) = couloirs(2) : couloirs(2) = a
  Else
    a = couloirs(2) : couloirs(2) = couloirs(1) : couloirs(1) = couloirs(0) : couloirs(0) = a
  End If
End Sub

Sub R_Lampes()
  Dim i
  For i = 0 To 2 : lampe(LP_haut0 + i) = B2E(couloirs(i)) : lampe(LP_centre0 + i) = B2E(centre(i)) : Next
  For i = 0 To 4 : lampe(LP_droite0 + i) = B2E(droite(i)) : Next
  lampe(LP_cibleh0) = B2E(ciblesH(0)) : lampe(LP_cibleh1) = B2E(ciblesH(1))
  If coffreOuvert Or mbAllume Or extraLit Then lampe(LP_coffre) = 2
  If multiball Then lampe(LP_mb) = 1 Else lampe(LP_mb) = 2 * B2E(mbAllume)
  If multiball Then lampe(LP_rampe) = 2 Else lampe(LP_rampe) = B2E(rampes Mod 3 = 2)
  lampe(LP_extra) = B2E(extraBalls > 0)
  For i = 2 To 5 : lampe(LP_x2 + i - 2) = B2E(mult >= i) : Next
  If maintenant < ballSaveUntil Then lampe(LP_sauve) = 2
End Sub

Function Valeur(n)
  If multiball Then Valeur = 2 * n Else Valeur = n
End Function

Sub Regle(nom)
  Select Case nom
    Case "Bumper1", "Bumper2", "Bumper3" : Ajouter 100, 0 : Son "bumper"
    Case "LanceG", "LanceD" : Ajouter 10, 0 : Son "lance_pierre"
    Case "SortieG", "SortieD" : Ajouter 1000, 1000 : Son "couloir"
    Case "RetourG", "RetourD" : Ajouter 500, 500 : Son "couloir"
    Case "HautA" : Couloir 0
    Case "HautB" : Couloir 1
    Case "HautC" : Couloir 2
    Case "Centre1" : Tombante centre, 0, 3, "centre"
    Case "Centre2" : Tombante centre, 1, 3, "centre"
    Case "Centre3" : Tombante centre, 2, 3, "centre"
    Case "Droite1" : Tombante droite, 0, 5, "droite"
    Case "Droite2" : Tombante droite, 1, 5, "droite"
    Case "Droite3" : Tombante droite, 2, 5, "droite"
    Case "Droite4" : Tombante droite, 3, 5, "droite"
    Case "Droite5" : Tombante droite, 4, 5, "droite"
    Case "CibleH1" : CibleHaut 0
    Case "CibleH2" : CibleHaut 1
    Case "Coffre" : AuCoffre
    Case "CapteurRampeG" : Rampe
  End Select
End Sub

Sub Couloir(i)
  Ajouter 500, 1000 : Son "couloir"
  couloirs(i) = True
  If couloirs(0) And couloirs(1) And couloirs(2) Then
    couloirs(0) = False : couloirs(1) = False : couloirs(2) = False
    Son "couloirs_faits" : MultBonus
  End If
End Sub

' une cible tombante de la banque (tableau etat, n cibles)
Sub Tombante(etat, i, n, banque)
  Dim k, toutes
  If etat(i) Then Exit Sub
  etat(i) = True
  Ajouter Valeur(500), 1000 : Son "tombante"
  toutes = True
  For k = 0 To n - 1 : If Not etat(k) Then toutes = False
  Next
  If Not toutes Then Exit Sub
  Son "banque" : banques = banques + 1
  If banque = "centre" Then
    centreFait = True : coffreOuvert = True
    Ajouter Valeur(5000), 5000 : Say "COFFRE OUVERT", 2000
    Apres 1500, "RemonterCentre"
  Else
    droiteFait = True
    Ajouter Valeur(10000), 5000 : Say "BANQUE " & banques, 2000
    Apres 1500, "RemonterDroite"
  End If
  If centreFait And droiteFait And Not multiball And Not mbAllume Then mbAllume = True : Say "MULTIBALL AU COFFRE", 2500
End Sub

Sub RemonterCentre()
  Remonter Array(Centre1, Centre2, Centre3)
  centre(0) = False : centre(1) = False : centre(2) = False
End Sub
Sub RemonterDroite()
  Remonter Array(Droite1, Droite2, Droite3, Droite4, Droite5)
  Dim k : For k = 0 To 4 : droite(k) = False : Next
End Sub

Sub CibleHaut(i)
  Ajouter 1000, 1000 : Son "cible"
  ciblesH(i) = True
  If ciblesH(0) And ciblesH(1) Then
    ciblesH(0) = False : ciblesH(1) = False
    If Not coffreOuvert Then coffreOuvert = True : Say "COFFRE OUVERT", 2000
  End If
End Sub

Sub AuCoffre()
  Son "trou"
  Ajouter 1000, 0
  If mbAllume And Not multiball Then
    mbAllume = False : centreFait = False : droiteFait = False
    Say "MULTIBALL", 3000
    LancerMultiball 3
  ElseIf extraLit Then
    DonnerExtra
  ElseIf coffreOuvert Then
    coffreOuvert = False
    Ajouter 10000 * IIf(banques > 0, banques, 1), 5000
    Say "COFFRE " & 10000 * IIf(banques > 0, banques, 1), 2500 : Son "jackpot"
  End If
  Ejecter "Coffre", 1500
End Sub

Sub Rampe()
  Son "rampe"
  rampes = rampes + 1
  If multiball Then
    Ajouter jackpot, 0
    Say "JACKPOT " & jackpot, 2500 : Son "jackpot"
    jackpot = jackpot + 5000
  Else
    Ajouter 2500, 2500
    If rampes Mod 3 = 0 Then AllumerExtra
  End If
End Sub

Dim SCENARIO : SCENARIO = Array("Bumper1", "LanceG", "HautA", "HautB", "HautC", "Centre1", "Centre2", "Centre3", _
  "Coffre", "Droite1", "Droite2", "Droite3", "Droite4", "Droite5", "Centre1", "Centre2", "Centre3", "Coffre", _
  "CapteurRampeG", "CapteurRampeG", "CapteurRampeG", "CibleH1", "CibleH2", "CapteurRampeG", "Coffre", "SortieG")
