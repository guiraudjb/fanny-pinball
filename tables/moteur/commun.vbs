' Table vierge : boucle de jeu commune (tables/moteur/commun.vbs), reprise de Fanny Pinball (outils/vpx/table.vbs)
' sans ses règles ni ses sons. Aucun ROM ni contrôleur. Le générateur insère ici l'en-tête de la table (noms des
' éléments, lampes, évènements) puis ses règles (regles.vbs).
'
' Ce que fournit ce fichier aux règles :
'   Ajouter points, bonus        score (et bonus de fin de bille)       Say texte, ms     message sur l'afficheur
'   Son "nom"                    son de moteur/sons                     Apres ms, "Sub"   minuterie (Sub sans argument)
'   LancerMultiball n                n billes en jeu (lancées par le distributeur), sauvetage de bille
'   AllumerExtra / DonnerExtra   bille supplémentaire                   MultBonus         multiplicateur de bonus + 1 (×5 max)
'   Remonter Array(cibles)       relève des cibles tombantes            Ejecter "Trou", ms  rend la bille d'un trou
'   lampe(LP_<nom>) = 0/1/2      éteinte, allumée, clignotante (à remplir dans R_Lampes)
'   multiball, score, bille, mult, maintenant, lanceTime (départ du lanceur), mode ("attract", "play", "bonus", "match", "over")
' Ce que les règles doivent définir :
'   R_Partie (nouvelle partie), R_Bille (nouvelle bille), R_FinMultiball, R_Lampes, R_Palette(sens),
'   Regle(nom) (contact d'un élément), R_Info (2e ligne de l'afficheur en jeu, "" = BILLE n),
'   SCENARIO (Array de noms d'éléments joués par l'essai -c1 logique)
Option Explicit
Randomize

' ==== EN-TETE ====
Const BILLES_PAR_PARTIE = 3, SAUVETAGE_MS = 8000, SAUVETAGE_MB_MS = 10000, MULT_MAX = 5, CREDITS_MAX = 9
Const AVERTISSEMENTS = 2, PENDULE_MS = 1200, KICK_LANCEUR = 55
Dim REPLAYS : REPLAYS = Array(150000, 300000, 500000)

Dim lampe(63), lampEtat(63), lampObj(63), lampFl(63), lampVu(63)
Dim maintenant, mode, credits, highScore, lastScore, matchNum, matchRolling
Dim msgText, msgStart, msgUntil
Dim score, bille, extraBalls, extraLit, replayIdx, ballsInPlay, pendingServes, multiball
Dim mult, bonus, ballSaveUntil, ballSaveArmed, shooterClosed, autoLaunchNext
Dim tiltWarnings, tiltIgnoreUntil, tilted, tiltPendule
Dim lanceTime : lanceTime = -10000          ' dernier départ d'une bille du couloir du lanceur
Dim essai : essai = ""

Const NB_MIN = 48
Dim minT(47), minA(47), minOn(47)

Sub Apres(ms, action)
  Dim i
  For i = 0 To NB_MIN - 1
    If Not minOn(i) Then minT(i) = maintenant + ms : Set minA(i) = GetRef(action) : minOn(i) = True : Exit Sub
  Next
End Sub

Sub Say(texte, ms)
  msgText = texte : msgStart = maintenant : msgUntil = maintenant + ms
End Sub

Sub Son(nom)
  PlaySound nom
End Sub

Function IIf(c, a, b)
  If c Then IIf = a Else IIf = b
End Function

Function B2E(b)
  If b Then B2E = 1 Else B2E = 0
End Function

' ---------------------------------------------------------------- démarrage
Sub Table1_Init()
  Dim i
  For i = 0 To NB_LAMPES - 1
    Set lampObj(i) = Eval("L_" & NOMS_LAMPES(i))
    Set lampFl(i) = Eval("F_" & NOMS_LAMPES(i))
    lampEtat(i) = -1 : lampVu(i) = -1
  Next
  For i = 0 To NB_MIN - 1 : minOn(i) = False : Next
  highScore = 0 : lastScore = 0 : credits = 0 : matchNum = -1 : matchRolling = False
  msgText = "" : mode = "attract" : maintenant = GameTime
  Distributeur.Enabled = False
  ResetGame
  Dim hs : hs = LoadValue(CLE_TABLE, "HighScore")
  If IsNumeric(hs) Then highScore = CLng(hs)
  essai = GetCustomParam(1)
  If essai = "test" Then Apres 1500, "TestDepart"
  If essai = "balayage" Then Apres 1500, "BalayageLot"
  If essai = "rampe" Then Apres 1500, "EssaiRampe"
  If essai = "logique" Then Apres 1500, "LogiqueDepart"
  If essai = "lanceur" Then Apres 1500, "LanceurDepart"
End Sub

Sub Table1_Exit()
  SaveValue CLE_TABLE, "HighScore", highScore
End Sub

' ---------------------------------------------------------------- partie, bille
Sub ResetGame()
  score = 0 : bille = 0 : extraBalls = 0 : extraLit = False : replayIdx = 0
  ballsInPlay = 0 : pendingServes = 0 : multiball = False
  R_Partie
  ResetBallState
End Sub

Sub ResetBallState()
  mult = 1 : bonus = 0
  ballSaveUntil = 0 : ballSaveArmed = False : autoLaunchNext = False
  tiltWarnings = 0 : tiltIgnoreUntil = 0 : tilted = False : tiltPendule = 0
  Dim c
  For Each c In TOMBANTES : c.IsDropped = False : Next
  R_Bille
End Sub

Sub Ajouter(points, b)
  If mode <> "play" Or tilted Then Exit Sub
  score = score + points
  bonus = bonus + b
  CheckReplay
End Sub

Sub MultBonus()
  If mult < MULT_MAX Then mult = mult + 1 : Say "BONUS X" & mult, 1500
End Sub

Sub Remonter(cibles)
  Dim c
  For Each c In cibles : c.IsDropped = False : Next
End Sub

Sub Ejecter(nom, ms)
  Apres ms, "Ejecter_" & nom
End Sub

Sub CheckReplay()
  Do While replayIdx <= UBound(REPLAYS)
    If score < REPLAYS(replayIdx) Then Exit Do
    replayIdx = replayIdx + 1
    FreeGame "PARTIE GRATUITE"
  Loop
End Sub

Sub FreeGame(texte)
  credits = credits + 1 : If credits > CREDITS_MAX Then credits = CREDITS_MAX
  Son "clac"
  Say texte, 2000
End Sub
Sub FreeGameRecord() : FreeGame "PARTIE GRATUITE" : End Sub

Sub AddCredit()
  credits = credits + 1 : If credits > CREDITS_MAX Then credits = CREDITS_MAX
  Son "credit"
End Sub

Sub StartGame()
  If mode <> "attract" And mode <> "over" Then Exit Sub
  Dim gratuite : gratuite = credits > 0
  If gratuite Then credits = credits - 1
  ResetGame
  matchNum = -1
  mode = "play" : bille = 1
  Son "depart"
  If gratuite Then Say "PARTIE GRATUITE", 3000 Else Say TITRE, 3000
  PowerOn
  ServeBall False
End Sub

' une bille au couloir du lanceur ; auto = lancée tout de suite (multiball, sauvetage)
Sub ServeBall(auto)
  ballsInPlay = ballsInPlay + 1
  pendingServes = pendingServes + 1
  If auto Then autoLaunchNext = True
  Distributeur.Enabled = True
  Distributeur.CreateBall
  If auto Then Distributeur.Kick 0, KICK_LANCEUR Else Distributeur.Kick 180, 1
  Apres 400, "CouperDistributeur"
End Sub
Sub CouperDistributeur() : Distributeur.Enabled = False : End Sub
Sub ServeAuto() : ServeBall True : End Sub

' n billes en jeu : les billes manquantes arrivent une à une par le lanceur
Sub LancerMultiball(n)
  Dim i
  If mode <> "play" Or tilted Then Exit Sub
  If Not multiball Then Son "multiball"
  multiball = True
  ballSaveUntil = maintenant + SAUVETAGE_MB_MS : ballSaveArmed = True
  For i = 1 To n - ballsInPlay
    Apres 600 * i, "ServeAuto"
  Next
End Sub

Sub AllumerExtra()
  If extraLit Then Exit Sub
  extraLit = True : Say "EXTRA BALL ALLUMEE", 2000
End Sub

Sub DonnerExtra()
  extraLit = False
  extraBalls = extraBalls + 1
  Son "extra" : Say "EXTRA BALL", 2500
End Sub

Sub StartBall()
  ResetBallState
  PowerOn
  ServeBall False
End Sub

Sub EndOfBall()
  mode = "bonus"
  If tilted Then
    bonus = 0 : Say "TILT", 1800 : Apres 1800, "NextBall" : Exit Sub
  End If
  If mult > 1 Then Say "BONUS X" & mult, 1200 Else Say "BONUS", 1200
  Apres 1200, "CountBonus"
End Sub

Sub CountBonus()
  If bonus <= 0 Then Apres 600, "NextBall" : Exit Sub
  Dim pas : pas = -Int(-bonus / 200) * 10
  If pas < 1000 Then pas = 1000
  If pas > bonus Then pas = bonus
  bonus = bonus - pas
  score = score + pas * mult
  CheckReplay
  Son "bonus"
  Apres 110, "CountBonus"
End Sub

Sub NextBall()
  mode = "play"
  If extraBalls > 0 Then
    extraBalls = extraBalls - 1 : Say "REJOUE", 1500 : StartBall
  ElseIf bille < BILLES_PAR_PARTIE Then
    bille = bille + 1 : Say "BILLE " & bille, 1500 : StartBall
  Else
    GameOver
  End If
End Sub

Sub GameOver()
  mode = "match"
  tilted = False
  PowerOn
  lastScore = score
  Dim record, ancien : record = score > highScore : ancien = highScore
  If record Then highScore = score : SaveValue CLE_TABLE, "HighScore", highScore
  If record Then Say "NOUVEAU RECORD", 2500 : Son "record" Else Say "FIN DE PARTIE", 2500 : Son "fin"
  If record And ancien > 0 Then
    Apres 2600, "FreeGameRecord" : Apres 5000, "StartMatch"
  Else
    Apres 2800, "StartMatch"
  End If
End Sub

Sub StartMatch()
  matchRolling = True : matchNum = 0
  Apres 2600, "FinMatch"
End Sub

Sub FinMatch()
  matchRolling = False
  matchNum = 10 * Int(Rnd * 10)
  If matchNum = ((score Mod 100) - (score Mod 10)) Then FreeGame "MATCH" Else Say "MATCH " & Right("0" & matchNum, 2), 1800
  mode = "over"
  Apres 5000, "RetourAttract"
End Sub

Sub RetourAttract()
  If mode = "over" Then mode = "attract" : matchNum = -1
End Sub

' ---------------------------------------------------------------- bobines (coupées au tilt)
Sub PowerOn()
  Dim o
  For Each o In BUMPERS : o.Force = 9 : Next
  For Each o In LANCE_PIERRES : o.SlingshotStrength = 80 : Next
End Sub

Sub PowerOff()
  Dim o
  For Each o In BUMPERS : o.Force = 0 : Next
  For Each o In LANCE_PIERRES : o.SlingshotStrength = 0 : Next
  For Each o In PALETTES_G : o.RotateToStart : Next
  For Each o In PALETTES_D : o.RotateToStart : Next
End Sub

' ---------------------------------------------------------------- clavier
Sub Table1_KeyDown(ByVal keycode)
  Dim o
  If keycode = StartGameKey Then StartGame : Exit Sub
  If keycode = AddCreditKey Or keycode = AddCreditKey2 Then AddCredit : Exit Sub
  If keycode = PlungerKey Then TirerLanceur : Exit Sub
  If keycode = LeftTiltKey Then Nudge 90, 2 : Secousse : Exit Sub
  If keycode = RightTiltKey Then Nudge 270, 2 : Secousse : Exit Sub
  If keycode = CenterTiltKey Then Nudge 0, 2 : Secousse : Exit Sub
  If keycode = MechanicalTilt Then HitTilt : Exit Sub
  If mode <> "play" Or tilted Then Exit Sub
  If keycode = LeftFlipperKey Then
    For Each o In PALETTES_G : o.RotateToEnd : Next
    PlaySound "palette", 0, 0.6, -0.3 : R_Palette -1
  End If
  If keycode = RightFlipperKey Then
    For Each o In PALETTES_D : o.RotateToEnd : Next
    PlaySound "palette", 0, 0.6, 0.3 : R_Palette 1
  End If
End Sub

Sub Table1_KeyUp(ByVal keycode)
  Dim o
  If keycode = PlungerKey Then LacherLanceur : If shooterClosed Then Son "lancement"
  If keycode = LeftFlipperKey Then For Each o In PALETTES_G : o.RotateToStart : Next
  If keycode = RightFlipperKey Then For Each o In PALETTES_D : o.RotateToStart : Next
End Sub

' pendule : trois coups de caisse rapprochés = contact TILT (deux avertissements, puis tilt)
Sub Secousse()
  If mode <> "play" Then Exit Sub
  tiltPendule = tiltPendule + 1
  If tiltPendule >= 3 Then tiltPendule = 0 : HitTilt
End Sub

Sub HitTilt()
  If mode <> "play" Then Exit Sub
  If tilted Or maintenant < tiltIgnoreUntil Then Exit Sub
  tiltIgnoreUntil = maintenant + PENDULE_MS
  tiltWarnings = tiltWarnings + 1
  If tiltWarnings <= AVERTISSEMENTS Then Say "ATTENTION", 1500 : Son "alerte" : Exit Sub
  tilted = True
  ballSaveUntil = 0 : multiball = False
  PowerOff
  Son "tilt"
  msgText = ""
End Sub

' ---------------------------------------------------------------- lanceur dosé (comme Fanny Pinball)
' La durée d'appui donne le tirage (pleine course en TIRAGE_MS) ; ressort précomprimé ; la bille part à
' LANCEUR_V × √(énergie) (110 % tiré à fond). Le lanceur de vpinball ne fait que le geste.
Const TIRAGE_MS = 900, PRECHARGE = 20, COURSE_LANCEUR = 50
Dim tirageDebut : tirageDebut = -1
Function ForceLanceur(p)
  Dim x : If p < 0 Then p = 0
  If p > 1 Then p = 1
  x = p * COURSE_LANCEUR
  ForceLanceur = 1.1 * Sqr((PRECHARGE * x + x * x / 2) / (PRECHARGE * COURSE_LANCEUR + COURSE_LANCEUR * COURSE_LANCEUR / 2))
End Function
Function BilleSurLanceur()
  Dim b : Set BilleSurLanceur = Nothing
  For Each b In GetBalls
    If b.X * 0.54 > LANCEUR_X - 16 And b.Y * 0.54 > LANCEUR_Y - 100 And Abs(b.VelY) < 3 Then Set BilleSurLanceur = b
  Next
End Function
Sub LancerBille(v)
  Dim b : Set b = BilleSurLanceur()
  If b Is Nothing Then Exit Sub
  b.AngMomX = 0 : b.AngMomY = 0 : b.AngMomZ = 0
  b.X = LANCEUR_X / 0.54
  b.VelX = 0 : b.VelY = -v * (1 + (Rnd - 0.5) * 0.04)
End Sub
Sub TirerLanceur() : tirageDebut = GameTime : Plunger.PullBack : End Sub
Sub LacherLanceur()
  Plunger.Fire
  If tirageDebut < 0 Then Exit Sub
  LancerBille LANCEUR_V * ForceLanceur((GameTime - tirageDebut) / TIRAGE_MS)
  tirageDebut = -1
End Sub

' ---------------------------------------------------------------- contacts
' tout contact du plateau : la bille est en jeu, le sauvetage démarre
Function Contact()
  Contact = False
  If mode <> "play" Or tilted Then Exit Function
  If Not ballSaveArmed Then
    ballSaveArmed = True
    If ballSaveUntil < maintenant + SAUVETAGE_MS Then ballSaveUntil = maintenant + SAUVETAGE_MS
  End If
  Contact = True
End Function

' anti-rebond : vpinball signale parfois plusieurs fois le même passage ; un contact compte une fois par 150 ms
Dim dernierCoup(255)
Sub Ev(k, nom)
  Dim t
  If GameTime - dernierCoup(k) < 150 Then Exit Sub
  dernierCoup(k) = GameTime
  If essai <> "" Then dernierContact = nom
  If Contact() Then
    Regle nom
  Else
    For Each t In TROUS                     ' hors partie, un trou rend la bille
      If t = nom Then Ejecter nom, 600
    Next
  End If
End Sub
Sub EvTour(nom)
  If Contact() Then Regle nom
End Sub

Sub CapteurLanceur_Hit()
  shooterClosed = True
  If pendingServes > 0 Then
    pendingServes = pendingServes - 1
    If autoLaunchNext Then autoLaunchNext = False : Apres 500, "LancementAuto"
  End If
End Sub
Sub CapteurLanceur_UnHit() : shooterClosed = False : lanceTime = GameTime : End Sub

Sub LancementAuto()
  If Not shooterClosed Then Exit Sub
  Son "lancement"
  Plunger.AutoPlunger = True : Plunger.Fire : Plunger.AutoPlunger = False
  LancerBille LANCEUR_V * ForceLanceur(1)
End Sub

Sub Drain_Hit()
  ActiveBall.DestroyBall
  If essai = "balayage" Or essai = "rampe" Or essai = "lanceur" Then Exit Sub
  ballsInPlay = ballsInPlay - 1 : If ballsInPlay < 0 Then ballsInPlay = 0
  If mode <> "play" Then Exit Sub
  If tilted Then
    If ballsInPlay = 0 Then Son "drain" : EndOfBall
    Exit Sub
  End If
  If Not ballSaveArmed And Not multiball Then Say "BILLE RENDUE", 1200 : ServeBall False : Exit Sub
  If maintenant < ballSaveUntil Then Say "BILLE RENDUE", 1500 : Son "balle_rendue" : ServeBall True : Exit Sub
  If multiball And ballsInPlay <= 1 Then multiball = False : R_FinMultiball
  If ballsInPlay = 0 Then Son "drain" : EndOfBall
End Sub

' ---------------------------------------------------------------- horloge : minuteries, lampes, afficheur
Dim dernierPendule : dernierPendule = 0
Sub Horloge_Timer()
  maintenant = GameTime
  Dim i, a
  For Each a In PrimLanceur : a.TransY = Plunger.Position * 3.2 : Next     ' pommeau et tige du lanceur (châssis)
  For i = 0 To NB_MIN - 1
    If minOn(i) Then
      If minT(i) <= maintenant Then minOn(i) = False : Set a = minA(i) : Call a()
    End If
  Next
  If msgText <> "" And maintenant > msgUntil Then msgText = ""
  If maintenant - dernierPendule > 1000 Then dernierPendule = maintenant : If tiltPendule > 0 Then tiltPendule = tiltPendule - 1
  MajLampes
  Afficheurs
  Musique
  AnimerGifs
End Sub

' ---------------------------------------------------------------- habillage : musiques (en boucle) et GIF animés du fond
'  MUSIQUE_ACCUEIL / MUSIQUE_JEU (générés, "" sans habillage) ; pas de musique pendant les essais (-c1)
Dim musiqueEnCours : musiqueEnCours = ""
Sub Musique()
  Dim m
  If essai <> "" And essai <> "0" Then Exit Sub
  If mode = "attract" Or mode = "over" Then m = MUSIQUE_ACCUEIL Else m = MUSIQUE_JEU
  If tilted Then m = ""
  If m = musiqueEnCours Then Exit Sub
  If musiqueEnCours <> "" Then StopSound musiqueEnCours
  musiqueEnCours = m
  If m <> "" Then PlaySound m, -1, IIf(m = MUSIQUE_JEU, 0.3, 0.45)
End Sub

'  GIFS (généré) : Array(flasher, préfixe des images, nombre de vues, durée d'une vue en ms)
Dim gifVue(7)
Sub AnimerGifs()
  Dim i, g, n
  For i = 0 To UBound(GIFS)
    g = GIFS(i)
    n = Int(maintenant / g(3)) Mod g(2)
    If n <> gifVue(i) Then gifVue(i) = n : g(0).ImageA = g(1) & Right("0" & n, 2)
  Next
End Sub

Sub MajLampes()
  Dim i, k, v
  For i = 0 To NB_LAMPES - 1 : lampe(i) = 0 : Next
  R_Lampes
  If tilted Then
    For i = 0 To NB_LAMPES - 1 : lampe(i) = 0 : Next
  End If
  If mode = "attract" Or mode = "over" Or mode = "match" Then
    k = Int(maintenant / 150)
    For i = 0 To NB_LAMPES - 1 : lampe(i) = B2E((i + k) Mod 6 = 0) : Next
  End If
  If essai = "lampes" Then
    For i = 0 To NB_LAMPES - 1 : lampe(i) = B2E(i Mod 2 = 0) : Next
  End If
  k = Int(maintenant / 125) Mod 2
  For i = 0 To NB_LAMPES - 1
    If lampEtat(i) <> lampe(i) Then lampEtat(i) = lampe(i) : lampObj(i).State = lampe(i)
    v = 0
    If lampe(i) = 1 Then v = 1
    If lampe(i) = 2 And k = 0 Then v = 1
    If lampVu(i) <> v Then lampVu(i) = v : lampFl(i).Visible = (v = 1)
  Next
End Sub

Function Pad(s, n)
  If Len(s) > n Then Pad = Right(s, n) Else Pad = Space(n - Len(s)) & s
End Function

Function ScrollText(texte, n, ecoule)
  If Len(texte) <= n Then
    Dim g : g = Int((n - Len(texte)) / 2)
    ScrollText = Left(Space(g) & texte & Space(n), n)
    Exit Function
  End If
  Dim p, pas : p = Space(n) & texte & Space(n)
  pas = Int(ecoule / 200) Mod (Len(p) - n + 1)
  ScrollText = Mid(p, pas + 1, n)
End Function

Sub Afficheurs()
  Dim s, info, phase, nm
  If tilted Then
    s = "  TILT  " : info = "TILT"
  Else
    If msgText <> "" Then
      s = ScrollText(msgText, 8, maintenant - msgStart)
    ElseIf mode = "attract" Then
      phase = Int(maintenant / 6000) Mod 3
      If phase = 0 Then
        s = ScrollText(TITRE, 8, maintenant Mod 6000)
      ElseIf phase = 1 Then
        s = Pad("HI " & highScore, 8)
      Else
        s = Pad(CStr(lastScore), 8)
      End If
    Else
      s = Pad(CStr(score), 8)
    End If
    If matchNum >= 0 And (mode = "match" Or mode = "over") Then
      If matchRolling Then nm = 10 * (Int(maintenant / 70) Mod 10) Else nm = matchNum
      info = "  " & Right("0" & nm, 2)
    ElseIf mode = "attract" Or mode = "over" Or mode = "match" Then
      If credits > 0 And (Int(maintenant / 2000) Mod 2) = 1 Then info = "CR " & credits Else info = "PLAY"
    Else
      info = R_Info()
      If info = "" Then info = "BILLE " & bille & "   BONUS X" & mult
    End If
  End If
  DessinerAfficheur s, UCase(info)
End Sub

' ---------------------------------------------------------------- afficheur à points (DMD 128 x 32), police 5 x 7
Const DMD_L = 128
Const DMD_H = 32
Const POLICE_CARS = " !'+-./0123456789:?ABCDEFGHIJKLMNOPQRSTUVWXYZ"
Dim POLICE : POLICE = Array( _
  0,0,0,0,0, 0,0,95,0,0, 0,5,3,0,0, 8,8,62,8,8, 8,8,8,8,8, 0,96,96,0,0, 32,16,8,4,2, _
  62,81,73,69,62, 0,66,127,64,0, 66,97,81,73,70, 33,65,69,75,49, 24,20,18,127,16, _
  39,69,69,69,57, 60,74,73,73,48, 1,113,9,5,3, 54,73,73,73,54, 6,73,73,41,30, _
  0,54,54,0,0, 2,1,81,9,6, _
  126,17,17,17,126, 127,73,73,73,54, 62,65,65,65,34, 127,65,65,34,28, 127,73,73,73,65, _
  127,9,9,1,1, 62,65,65,81,50, 127,8,8,8,127, 0,65,127,65,0, 32,64,65,63,1, _
  127,8,20,34,65, 127,64,64,64,64, 127,2,4,2,127, 127,4,8,16,127, 62,65,65,65,62, _
  127,9,9,9,6, 62,65,81,33,94, 127,9,25,41,70, 70,73,73,73,49, 1,1,127,1,1, _
  63,64,64,64,63, 31,32,64,32,31, 127,32,24,32,127, 99,20,8,20,99, 3,4,120,4,3, 97,81,73,69,67)
Dim dmdPoints(4095)
Dim DMD_SCORE : DMD_SCORE = RGB(120, 200, 255)
Dim DMD_INFO : DMD_INFO = RGB(200, 230, 255)
Dim dmdAvant : dmdAvant = Chr(1)

Sub DmdTexte(t, x0, y0, k, lum)
  Dim i, c, n, col, bits, r, a, b
  For i = 1 To Len(t)
    c = Mid(t, i, 1)
    If c = "x" Then c = "X"
    n = InStr(POLICE_CARS, c) - 1
    If n < 0 Then n = 0
    For col = 0 To 4
      bits = POLICE(n * 5 + col)
      If bits <> 0 Then
        For r = 0 To 6
          If (bits And (2 ^ r)) <> 0 Then
            For a = 0 To k - 1
              For b = 0 To k - 1
                If x0 + col * k + a < DMD_L And y0 + r * k + b < DMD_H Then dmdPoints((y0 + r * k + b) * DMD_L + x0 + col * k + a) = lum
              Next
            Next
          End If
        Next
      End If
    Next
    x0 = x0 + 6 * k
  Next
End Sub

Sub DessinerAfficheur(s, info)
  Dim i, t
  If s & "|" & info = dmdAvant Then Exit Sub
  dmdAvant = s & "|" & info
  For i = 0 To 4095 : dmdPoints(i) = 0 : Next
  DmdTexte s, Int((DMD_L - Len(s) * 12) / 2) + 1, 2, 2, DMD_SCORE
  t = Trim(info)
  DmdTexte t, Int((DMD_L - Len(t) * 6) / 2) + 1, 23, 1, DMD_INFO
  DMDWidth = DMD_L : DMDHeight = DMD_H
  DMDColoredPixels = dmdPoints
End Sub

' ---------------------------------------------------------------- essais (VPinballX_GL -c1 <essai> -Play table.vpx)
' test : partie, tir à fond, trajet de la bille (ESSAI …)
Dim testT0
Sub TestDepart() : Debug.Print "ESSAI depart" : StartGame : Apres 2500, "TestTire" : End Sub
Sub TestTire() : TirerLanceur : Apres 1200, "TestLache" : End Sub
Sub TestLache() : LacherLanceur : testT0 = maintenant : Apres 100, "TestJournal" : End Sub
Sub TestJournal()
  Dim b
  For Each b In GetBalls : Debug.Print "ESSAI t=" & (maintenant - testT0) & " x=" & Int(b.X * 0.54) & " y=" & Int(b.Y * 0.54) & " z=" & Int(b.Z) : Next
  If maintenant - testT0 < 6000 Then Apres 200, "TestJournal" Else Debug.Print "ESSAI fin score=" & score
End Sub

Function UneBille()
  Dim b : Set UneBille = Nothing
  For Each b In GetBalls : Set UneBille = b : Next
End Function

Sub ViderTable()
  ' billes détruites (déplacées dans l'évacuation, elles n'y « entraient » pas et restaient au fond)
  Dim b
  For Each b In GetBalls : b.DestroyBall : Next
End Sub

Function NouvelleBille(x, y)
  Distributeur.Enabled = True
  Set NouvelleBille = Distributeur.CreateBall
  Distributeur.Kick 0, 0
  Distributeur.Enabled = False
  NouvelleBille.X = x : NouvelleBille.Y = y : NouvelleBille.Z = 25
  NouvelleBille.VelX = 0 : NouvelleBille.VelY = 0 : NouvelleBille.VelZ = 0
End Function

' lanceur : une bille posée sur la pointe par durée d'appui ; vitesse, point le plus haut, trajet
Dim LANCEUR_MS : LANCEUR_MS = Array(300, 500, 700, 900, 1200, 900, 900)
Dim lanceurI, lanceurT0, lanceurYmin, lanceurTrace
Sub LanceurDepart() : Debug.Print "LANCEUR depart" : lanceurI = 0 : Apres 500, "LanceurPose" : End Sub
Sub LanceurPose()
  ' bille précédente envoyée dans l'évacuation (la détruire en pleine retombée sur la tige bloquait le lanceur
  ' sur la Batocera pour la suite de l'essai)
  Dim v
  For Each v In GetBalls
    v.X = 240 / 0.54 : v.Y = 1180 / 0.54 : v.Z = 25 : v.VelX = 0 : v.VelY = 2 : v.VelZ = 0
  Next
  Dim b : Set b = NouvelleBille(LANCEUR_X / 0.54, (LANCEUR_Y - 3) / 0.54)
  Apres 1500, "LanceurTire"
End Sub
Sub LanceurTire() : TirerLanceur : Apres LANCEUR_MS(lanceurI), "LanceurLache" : End Sub
Sub LanceurLache()
  LacherLanceur
  lanceurT0 = maintenant : lanceurYmin = 9999 : lanceurTrace = "" : dernierContact = ""
  Apres 20, "LanceurSuivi"
End Sub
Sub LanceurSuivi()
  Dim b : Set b = UneBille()
  If Not b Is Nothing Then
    If b.Y * 0.54 < lanceurYmin Then lanceurYmin = b.Y * 0.54
    If (maintenant - lanceurT0) Mod 200 < 20 And maintenant - lanceurT0 < 3000 Then lanceurTrace = lanceurTrace & " " & Int(b.X * 0.54) & "," & Int(b.Y * 0.54)
  End If
  If maintenant - lanceurT0 < 3500 Then Apres 20, "LanceurSuivi" : Exit Sub
  Debug.Print "LANCEUR appui " & LANCEUR_MS(lanceurI) & " ms : plus haut y=" & Int(lanceurYmin) & " mm, trajet" & lanceurTrace
  lanceurI = lanceurI + 1
  If lanceurI > UBound(LANCEUR_MS) Then Debug.Print "LANCEUR fin" : Exit Sub
  LanceurPose
End Sub

' balayage : billes posées sans vitesse sur une grille du plateau ; immobile après 4,5 s = BLOQUE
Const LOT_BALAYAGE = 14
Dim balayageI : balayageI = 0
Dim balPas : balPas = 0
Dim balX(13), balY(13), balN
Dim dernierContact : dernierContact = ""

Sub BalayageLot()
  Dim i, k, b, total
  total = (UBound(POINTS_ESSAI) + 1) / 3
  ViderTable
  If balayageI >= total Then Debug.Print "BALAYAGE fin " & total & " points" : Exit Sub
  balPas = Int(total / LOT_BALAYAGE) + 1
  For i = 0 To LOT_BALAYAGE - 1
    k = (balayageI Mod balPas) + i * balPas
    If k < total And balayageI < total Then
      Set b = NouvelleBille(POINTS_ESSAI(3 * k), POINTS_ESSAI(3 * k + 1))
    End If
  Next
  balayageI = balayageI + 1
  If balayageI > balPas Then balayageI = total
  Apres 3000, "BalayageMesure1"
End Sub

Sub BalayageMesure1()
  Dim b, i : i = 0
  For Each b In GetBalls
    If i < 14 Then balX(i) = b.X : balY(i) = b.Y
    i = i + 1
  Next
  balN = i
  Apres 1500, "BalayageMesure2"
End Sub

Sub BalayageMesure2()
  Dim b, i, d, dmin
  For Each b In GetBalls
    dmin = 1E9
    For i = 0 To balN - 1
      If i < 14 Then
        d = Sqr((b.X - balX(i)) ^ 2 + (b.Y - balY(i)) ^ 2)
        If d < dmin Then dmin = d
      End If
    Next
    If b.Z < -20 Or b.X < -20 Or b.X > 1000 Or b.Y < -20 Or b.Y > 2400 Then
      Debug.Print "PERDUE x=" & Int(b.X * 0.54) & " y=" & Int(b.Y * 0.54) & " z=" & Int(b.Z)
    ElseIf dmin < 3 And b.X * 0.54 < 476 Then
      Debug.Print "BLOQUE x=" & Int(b.X * 0.54) & " y=" & Int(b.Y * 0.54) & " z=" & Int(b.Z)
    End If
  Next
  Debug.Print "BALAYAGE lot " & balayageI & "/" & balPas
  BalayageLot
End Sub

' rampe : tirs dans l'axe de chaque entrée de rampe (ESSAIS_RAMPE, généré) ; le contact de la rampe est-il touché ?
Dim essaiRampeI : essaiRampeI = 0
Dim essaiT0, essaiZmax, essaiVu

Sub EssaiRampe()
  Dim b, e
  ViderTable
  If essaiRampeI > UBound(ESSAIS_RAMPE) Then Debug.Print "RAMPE fin" : Exit Sub
  e = ESSAIS_RAMPE(essaiRampeI)
  Set b = NouvelleBille(e(1) / 0.54, e(2) / 0.54)
  b.VelX = e(3) * e(5) : b.VelY = e(4) * e(5)
  essaiT0 = maintenant : essaiZmax = 0 : essaiVu = "" : dernierContact = ""
  Apres 50, "EssaiRampeSuivi"
End Sub

Sub EssaiRampeSuivi()
  Dim b, n, e : n = 0
  e = ESSAIS_RAMPE(essaiRampeI)
  If dernierContact <> "" And InStr(essaiVu, dernierContact) = 0 Then essaiVu = essaiVu & " " & dernierContact
  For Each b In GetBalls
    n = n + 1
    If b.Z > essaiZmax Then essaiZmax = b.Z
  Next
  If n = 0 Or maintenant - essaiT0 > 5000 Then
    Debug.Print "RAMPE " & e(0) & " : " & IIf(InStr(essaiVu, e(6)) > 0 And e(6) <> "", "REUSSIE", "ratee") & _
      ", hauteur max " & Int((essaiZmax - 25) * 0.54) & " mm, contacts" & essaiVu
    For Each b In GetBalls : Debug.Print "RAMPE   fin x=" & Int(b.X * 0.54) & " y=" & Int(b.Y * 0.54) & " h=" & Int((b.Z - 25) * 0.54) : Next
    essaiRampeI = essaiRampeI + 1
    Apres 300, "EssaiRampe"
  Else
    Apres 50, "EssaiRampeSuivi"
  End If
End Sub

' logique : une partie dont les contacts sont joués par le script (SCENARIO des règles), points et messages au journal
Dim logiqueI, logiqueScore
Sub LogiqueDepart()
  Debug.Print "LOGIQUE depart"
  StartGame
  ballSaveArmed = True : ballSaveUntil = 0
  logiqueI = 0
  Apres 2500, "LogiqueEtape"
End Sub
Sub LogiqueEtape()
  Dim nom
  If logiqueI > UBound(SCENARIO) Then
    Debug.Print "LOGIQUE fin score=" & score & " bonus=" & bonus & " mult=" & mult & " billes=" & ballsInPlay & " multiball=" & multiball
    Exit Sub
  End If
  nom = SCENARIO(logiqueI)
  logiqueScore = score
  msgText = ""
  If Contact() Then Regle nom
  Apres 350, "LogiqueJournal"
End Sub
Sub LogiqueJournal()
  Debug.Print "LOGIQUE " & Right("   " & logiqueI, 3) & " " & SCENARIO(logiqueI) & " : +" & (score - logiqueScore) & _
    " score=" & score & IIf(msgText <> "", " [" & msgText & "]", "") & " " & R_Etat()
  logiqueI = logiqueI + 1
  Apres 150, "LogiqueEtape"
End Sub

' ==== REGLES ====
