' Fanny Pinball — Pétanque World Tour : règles de la table Visual Pinball.
' Portage de js/rules.js (même boucle de jeu, mêmes valeurs, mêmes numéros de sons que le DFPlayer de la réplique).
' Table originale : aucun ROM, aucun contrôleur (pas de controller.vbs ni de core.vbs).
'
'   F-A-N-N-Y allume le Cercle ; bille dans le Cercle allumé = MULTIBALL (3 billes), puis F-A-N-N-Y ×2, ×3…
'   Multiball : chaque rampe = JACKPOT (+5 000 à chaque fois) ; trois jackpots = SUPER JACKPOT au Cercle.
'   T-O-U-R (couloirs du haut, décalés par les batteurs) : bonus ×2 … ×5, puis EXTRA BALL au Cercle.
'   BOUCHON : CARREAU sur TIRER pendant 20 s ; POINTER (ou TRIPLETTE) puis BOUCHON = BIBERON.
'   Rampe : escales du World Tour ; 7 escales = GRAND CHELEM + EXTRA BALL.
'   TILT, partie gratuite (clac) à 150 000 / 300 000 / 500 000 et au record, MATCH en fin de partie.
Option Explicit
Randomize

Const BALLS_PER_GAME = 3, BALL_SAVE_MS = 8000, MB_BALL_SAVE_MS = 10000, MAX_MULT = 5
Const JACKPOT_START = 20000, JACKPOT_STEP = 5000, CARREAU_MS = 20000, CARREAU_PTS = 10000
Const MAX_CREDITS = 9, EXTRA_MAX = 2, EXTRA_POINTS = 25000, SUPER_AFTER = 3
Const TILT_WARNINGS = 2, TILT_SETTLE_MS = 1200, KICK_LANCEUR = 55

' sons : assets/sons/00NN.mp3, rangés dans la table sous le nom sNNNN
Const SND_START = 1, SND_BUMPER = 2, SND_SLING = 3, SND_FLIP = 4, SND_DROP = 5, SND_DROPS_DONE = 6, SND_RAMP = 7
Const SND_LANE = 8, SND_LANES_DONE = 9, SND_STANDUP = 10, SND_SAUCER = 11, SND_MULTIBALL = 12, SND_JACKPOT = 13
Const SND_CITY = 14, SND_GRAND_CHELEM = 15, SND_EXTRA = 16, SND_BALL_SAVE = 17, SND_DRAIN = 18, SND_BONUS = 19
Const SND_GAME_OVER = 20, SND_LAUNCH = 21, SND_MUSIQUE_GENERIQUE = 22, SND_MUSIQUE_THEME = 23
Const V_START = 24, V_MULTIBALL = 25, V_JACKPOT = 26, V_CARREAU = 27, V_BIBERON = 28, V_BOUCHON = 29, V_TRIPLETTE = 30
Const V_GRAND_CHELEM = 31, V_EXTRA = 32, V_BALL_SAVE = 33, V_MB_LIT = 34, V_BONUS_MULT = 35, V_DRAIN = 36
Const V_GAME_OVER = 37, V_RECORD = 38, V_CITY_1 = 39, SND_CLAC = 45, SND_MATCH = 46
Const V_PARTIE_GRATUITE = 47, V_MATCH = 48, V_EXTRA_LIT = 49, V_SUPER_JACKPOT = 50, SND_NUDGE = 51, SND_TILT = 52
Const V_ATTENTION = 53, V_TILT = 54

Dim CITIES : CITIES = Array("MARSEILLE", "PARIS", "LONDRES", "NEW YORK", "TOKYO", "RIO", "SYDNEY")
Dim NOMS_LAMPES : NOMS_LAMPES = Array("lane0", "lane1", "lane2", "lane3", "drop0", "drop1", "drop2", "drop3", "drop4", "multiball", _
  "ramp", "jackpot", "city0", "city1", "city2", "city3", "city4", "city5", "city6", "mult2", "mult3", "mult4", "mult5", _
  "extra", "save", "carreau", "bouchon", "point", "cible0", "cible1", "cible2", "extraLit")
Dim lampEtat(31), lampObj(31)

' ---------------------------------------------------------------- état (mêmes noms que rules.js)
Dim maintenant, mode, credits, highScore, lastScore, matchNum, matchRolling
Dim msgText, msgStart, msgUntil
Dim score, bille, extraBalls, extrasGiven, extraLit, replayIdx, ballsInPlay, pendingServes
Dim city, mbLit, multiball, mbCount, fannyDone, jackpot, jackpotsMb, superLit, carreaux
Dim mult, bonus, pointLit, carreauUntil, ballSaveUntil, ballSaveArmed, shooterClosed, autoLaunchNext
Dim saucerBusy, tiltWarnings, tiltIgnoreUntil, tilted, tiltPendule, voixEnCours, musiqueEnCours
Dim letters(3), drops(4), targets(2)
Dim REPLAY_LEVELS : REPLAY_LEVELS = Array(150000, 300000, 500000)

' minuteries de rules.js (after) : action = nom d'une procédure sans argument (GetRef)
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

' ---------------------------------------------------------------- sons
Function NomSon(n)
  NomSon = "s" & Right("000" & n, 4)
End Function

Function EstVoix(n)
  EstVoix = (n >= V_START And n <= V_CITY_1 + 5) Or (n >= V_PARTIE_GRATUITE And n <= V_SUPER_JACKPOT) Or n >= V_ATTENTION
End Function

Sub Son(n)
  If EstVoix(n) Then                        ' voix de Fanny : une réplique coupe la précédente
    If voixEnCours <> "" Then StopSound voixEnCours
    voixEnCours = NomSon(n)
  End If
  PlaySound NomSon(n)
End Sub

Sub Musique(n)
  If musiqueEnCours <> "" Then StopSound musiqueEnCours
  musiqueEnCours = ""
  If n > 0 Then musiqueEnCours = NomSon(n) : PlaySound musiqueEnCours, -1, 0.35
End Sub

' ---------------------------------------------------------------- démarrage de la table
Sub Table1_Init()
  Dim i
  For i = 0 To 31
    Set lampObj(i) = Eval("L_" & NOMS_LAMPES(i))
    lampObj(i).BlinkInterval = 125
    lampEtat(i) = -1
  Next
  For i = 0 To NB_MIN - 1 : minOn(i) = False : Next
  highScore = 0 : lastScore = 0 : credits = 0 : matchNum = -1 : matchRolling = False
  msgText = "" : voixEnCours = "" : musiqueEnCours = "" : mode = "attract" : maintenant = GameTime
  Distributeur.Enabled = False
  ResetGame
  Dim hs : hs = LoadValue("FannyPinball", "HighScore")
  If IsNumeric(hs) Then highScore = CLng(hs)
  Musique SND_MUSIQUE_GENERIQUE
  If GetCustomParam(1) = "test" Then Apres 1500, "TestDepart"
  If GetCustomParam(1) = "balayage" Then Apres 1500, "BalayageLot"
  If GetCustomParam(1) = "rampe" Then Apres 1500, "EssaiRampe"
  If GetCustomParam(1) = "logique" Then essaiLogique = True : Apres 1500, "LogiqueDepart"
End Sub

' ---------------------------------------------------------------- décor d'origine : pièces animées à chaque image
Sub Anim_Timer()
  Dim p, a
  a = LeftFlipper.CurrentAngle - LeftFlipper.StartAngle
  For Each p In PrimPaletteG : p.RotZ = a : Next
  a = RightFlipper.CurrentAngle - RightFlipper.StartAngle
  For Each p In PrimPaletteD : p.RotZ = a : Next
  AnimCible PrimCible0, DT_F : AnimCible PrimCible1, DT_A : AnimCible PrimCible2, DT_N1
  AnimCible PrimCible3, DT_N2 : AnimCible PrimCible4, DT_Y
  a = Plunger.Position * 3.2
  For Each p In PrimLanceur : p.TransY = a : Next
End Sub

Sub AnimCible(prims, cible)
  Dim p, z
  If cible.IsDropped Then z = -62 Else z = 0
  For Each p In prims
    If p.TransZ <> z Then p.TransZ = z
  Next
End Sub

' ---------------------------------------------------------------- essai automatique (VPinballX -c1 test) : journal
' départ, tir du lanceur à pleine course, positions de la bille dans le journal de vpinball (Debug.Print)
Dim testT0 : testT0 = 0
Sub TestDepart() : Debug.Print "ESSAI depart" : StartGame : Apres 2500, "TestTire" : End Sub
Sub TestTire() : Debug.Print "ESSAI tire" : Plunger.PullBack : Apres 1500, "TestLache" : End Sub
Sub TestLache()
  Debug.Print "ESSAI lache"
  Plunger.Fire
  testT0 = maintenant
  Apres 100, "TestJournal"
End Sub
Sub TestJournal()
  Dim b
  For Each b In GetBalls
    Debug.Print "ESSAI t=" & (maintenant - testT0) & " x=" & Int(b.X) & " y=" & Int(b.Y) & " z=" & Int(b.Z) & " vy=" & Int(b.VelY)
  Next
  If maintenant - testT0 < 4000 Then Apres 100, "TestJournal" Else TestPalettes
End Sub
Sub TestPalettes() : Debug.Print "ESSAI palettes" : LeftFlipper.RotateToEnd : RightFlipper.RotateToEnd : End Sub

' ---------------------------------------------------------------- balayage des zones de blocage (VPinballX -c1 balayage)
' Des billes posées sans vitesse sur une grille de tout le plateau (et sur la rampe), par lots de billes éloignées :
' plateau incliné, palettes baissées, une bille qui ne bouge plus au bout de 4 s est coincée (BLOQUE) ; une bille
' qui sort du plateau ou passe dessous trahit un collider mal orienté (PERDUE).
Const LOT_BALAYAGE = 14
Dim balayageI : balayageI = 0
Dim balPas : balPas = 0
Dim balDepart(13), balX(13), balY(13), balN

' DestroyBall laisse en place une bille coincée dans un pli : on la pose dans l'évacuation, Drain_Hit la retire
Sub ViderTable()
  Dim b
  For Each b In GetBalls
    b.X = 240 / 0.54 : b.Y = 1125 / 0.54 : b.Z = 25 : b.VelX = 0 : b.VelY = 2 : b.VelZ = 0
  Next
End Sub

Sub BalayageLot()
  Dim i, k, b, total
  total = (UBound(POINTS_ESSAI) + 1) / 3
  ViderTable
  If balayageI >= total Then Debug.Print "BALAYAGE fin " & total & " points" : Exit Sub
  balPas = Int(total / LOT_BALAYAGE) + 1
  balN = 0
  For i = 0 To LOT_BALAYAGE - 1
    k = (balayageI Mod balPas) + i * balPas        ' points répartis sur tout le plateau dans un même lot
    If k < total And balayageI < total Then
      Distributeur.Enabled = True
      Set b = Distributeur.CreateBall
      Distributeur.Kick 0, 0
      b.X = POINTS_ESSAI(3 * k) : b.Y = POINTS_ESSAI(3 * k + 1) : b.Z = POINTS_ESSAI(3 * k + 2)
      b.VelX = 0 : b.VelY = 0 : b.VelZ = 0
      balDepart(balN) = k : balN = balN + 1
    End If
  Next
  Distributeur.Enabled = False
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

' une bille coincée est encore (à 3 VP près) là où était une bille 1,5 s plus tôt
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
      Debug.Print "PERDUE x=" & Int(b.X) & " y=" & Int(b.Y) & " z=" & Int(b.Z)
    ElseIf dmin < 3 And b.X < 880 Then
      Debug.Print "BLOQUE x=" & Int(b.X) & " y=" & Int(b.Y) & " z=" & Int(b.Z)
    End If
  Next
  Debug.Print "BALAYAGE lot " & balayageI & "/" & balPas
  BalayageLot
End Sub

' ---------------------------------------------------------------- essai de la rampe (VPinballX -c1 rampe)
' tirs de face à trois vitesses (unités VP par 10 ms), puis billes posées derrière l'entrée, sous la rampe
Dim ESSAIS_RAMPE : ESSAIS_RAMPE = Array( _
  Array("face lent", 196, 570, 25, -0.2, -0.98, 22), Array("face moyen", 196, 570, 25, -0.2, -0.98, 32), _
  Array("face fort", 196, 570, 25, -0.2, -0.98, 45), Array("arriere 1", 178, 455, 25, 0, 0, 0), _
  Array("arriere 2", 165, 440, 25, 0, 0, 0), Array("arriere 3", 190, 430, 25, 0, 0, 0), _
  Array("haut 100", 100, 300, 25, 0.1, 1, 15), Array("haut 125", 125, 300, 25, 0.1, 1, 15), _
  Array("haut 150", 150, 300, 25, 0, 1, 15), Array("haut 175", 175, 300, 25, 0, 1, 15), _
  Array("haut 200", 200, 300, 25, -0.1, 1, 15), Array("haut 225", 225, 300, 25, -0.2, 1, 15), _
  Array("haut 150 vite", 150, 250, 25, -0.1, 1, 35), Array("haut 180 vite", 180, 250, 25, -0.2, 1, 35))
Dim essaiRampeI : essaiRampeI = 0
Dim essaiT0, essaiZmax

Sub EssaiRampe()
  Dim b, e
  ViderTable
  If essaiRampeI > UBound(ESSAIS_RAMPE) Then Debug.Print "RAMPE fin" : Exit Sub
  e = ESSAIS_RAMPE(essaiRampeI)
  Distributeur.Enabled = True
  Set b = Distributeur.CreateBall
  Distributeur.Kick 0, 0
  Distributeur.Enabled = False
  b.X = e(1) / 0.54 : b.Y = e(2) / 0.54 : b.Z = e(3)
  b.VelX = e(4) * e(6) : b.VelY = e(5) * e(6) : b.VelZ = 0
  Debug.Print "RAMPE essai " & e(0)
  essaiT0 = maintenant : essaiZmax = 0
  Apres 100, "EssaiRampeSuivi"
End Sub

Sub EssaiRampeSuivi()
  Dim b, n : n = 0
  For Each b In GetBalls
    n = n + 1
    If b.Z > essaiZmax Then essaiZmax = b.Z
    If ((maintenant - essaiT0) Mod 300) < 100 Then Debug.Print "RAMPE   t=" & (maintenant - essaiT0) & " x=" & Int(b.X * 0.54) & " y=" & Int(b.Y * 0.54) & " h=" & Int((b.Z - 25) * 0.54) & "mm"
  Next
  If n = 0 Or maintenant - essaiT0 > 6000 Then
    Debug.Print "RAMPE   hauteur max " & Int((essaiZmax - 25) * 0.54) & " mm" & IIf(n = 0, " (evacuee)", "")
    For Each b In GetBalls : Debug.Print "RAMPE   fin x=" & Int(b.X * 0.54) & " y=" & Int(b.Y * 0.54) & " h=" & Int((b.Z - 25) * 0.54) : Next
    essaiRampeI = essaiRampeI + 1
    Apres 200, "EssaiRampe"
  Else
    Apres 100, "EssaiRampeSuivi"
  End If
End Sub

' ---------------------------------------------------------------- essai de la logique de jeu (VPinballX -c1 logique)
' Une partie jouée par le script : la bille est lancée sur chaque élément du plateau (position et direction en mm,
' vitesse en unités VP / 10 ms), le journal donne les points gagnés et les messages ; puis le scénario complet :
' F-A-N-N-Y, multiball au Cercle, trois jackpots à la rampe, super jackpot, fin de mène, bonus, tilt, fin de partie, match.
'   étape : Array(genre, nom, x, y, dx, dy, vitesse, attente ms, attendu)
Dim LOGIQUE : LOGIQUE = Array( _
  Array("tir", "bumper 1", 185, 322, 0, -1, 15, 1500, "100 par coup"), _
  Array("tir", "bumper 2", 293, 322, 0, -1, 15, 1500, "100 par coup"), _
  Array("tir", "bumper 3", 239, 404, 0, -1, 15, 1500, "100 par coup"), _
  Array("tir", "lance-pierres G", 182.1, 945, -0.927, 0.375, 12, 1200, "10"), _
  Array("tir", "lance-pierres D", 295.9, 945, 0.927, 0.375, 12, 1200, "10"), _
  Array("tir", "couloir T", 176, 135, 0, 1, 4, 1500, "300, lettre T"), _
  Array("tir", "couloir O", 218, 135, 0, 1, 4, 1500, "300, lettre O"), _
  Array("tir", "couloir U", 260, 135, 0, 1, 4, 1500, "300, lettre U"), _
  Array("tir", "couloir R", 302, 135, 0, 1, 4, 1500, "300 + BONUS X2"), _
  Array("tir", "couloir bas outL", 18, 912, 0, 1, 5, 1200, "1000"), _
  Array("tir", "couloir bas inExtL", 61, 912, 0, 1, 5, 1200, "500"), _
  Array("etat", "", 0, 0, 0, 0, 0, 0, "après évacuation"), _
  Array("tir", "couloir bas inIntR", 375, 912, 0, 1, 5, 1200, "500"), _
  Array("tir", "couloir bas outR", 460, 912, 0, 1, 5, 1200, "1000"), _
  Array("tir", "tourniquet", 185.2, 517.5, -0.2, -0.98, 20, 1500, "250 par tour"), _
  Array("tir", "boule 1", 70, 736, -1, 0, 15, 1200, "300"), _
  Array("tir", "boule 2", 70, 776, -1, 0, 15, 1200, "300"), _
  Array("tir", "boule 3", 70, 816, -1, 0, 15, 1200, "300 + 3000 TRIPLETTE"), _
  Array("tir", "tirer (sans carreau)", 49.8, 653.8, -0.445, -0.895, 15, 1200, "500"), _
  Array("tir", "pointer", 51.3, 533.7, -0.445, -0.895, 15, 1200, "500"), _
  Array("tir", "bouchon", 64, 447.6, -0.35, -0.94, 15, 1500, "1500 + 5000 BIBERON"), _
  Array("tir", "tirer (carreau)", 49.8, 653.8, -0.445, -0.895, 15, 1500, "CARREAU 10000"), _
  Array("tir", "cible F", 346.66, 619.11, 0.966, -0.259, 15, 1200, "500"), _
  Array("tir", "cible A", 354.88, 649.78, 0.966, -0.259, 15, 1200, "500"), _
  Array("tir", "cible N", 363.1, 680.45, 0.966, -0.259, 15, 1200, "500"), _
  Array("tir", "cible N", 371.31, 711.12, 0.966, -0.259, 15, 1200, "500"), _
  Array("tir", "cible Y", 379.53, 741.79, 0.966, -0.259, 15, 2000, "500 + MULTIBALL AU CERCLE"), _
  Array("etat", "", 0, 0, 0, 0, 0, 0, "mbLit"), _
  Array("tir", "rampe", 196, 570, -0.2, -0.98, 45, 8000, "2000 + escale PARIS"), _
  Array("tir", "Cercle (multiball)", 400, 360, 0, 0, 0, 7000, "TRIPLETTE MULTIBALL, 3 billes"), _
  Array("etat", "", 0, 0, 0, 0, 0, 0, "multiball, 3 billes"), _
  Array("tir", "rampe (jackpot 1)", 196, 570, -0.2, -0.98, 45, 8000, "2000 + JACKPOT 20000"), _
  Array("tir", "rampe (jackpot 2)", 196, 570, -0.2, -0.98, 45, 8000, "2000 + JACKPOT 25000"), _
  Array("tir", "rampe (jackpot 3)", 196, 570, -0.2, -0.98, 45, 8000, "2000 + JACKPOT 30000, super allumé"), _
  Array("etat", "", 0, 0, 0, 0, 0, 0, "superLit"), _
  Array("tir", "Cercle (super jackpot)", 400, 360, 0, 0, 0, 3000, "SUPER JACKPOT 105000"), _
  Array("sauvetage", "", 0, 0, 0, 0, 0, 0, "fin du sauvetage de bille"), _
  Array("vidange", "", 0, 0, 0, 0, 0, 9000, "FIN DE LA MENE, bonus, BILLE 2"), _
  Array("etat", "", 0, 0, 0, 0, 0, 0, "bille 2, mult 1"), _
  Array("tir", "bumper (arme le sauvetage)", 185, 322, 0, -1, 15, 1500, ""), _
  Array("tilt", "", 0, 0, 0, 0, 0, 1500, "ATTENTION"), _
  Array("tilt", "", 0, 0, 0, 0, 0, 1500, "ATTENTION"), _
  Array("tilt", "", 0, 0, 0, 0, 0, 1500, "TILT"), _
  Array("tir", "bumper sous tilt", 185, 322, 0, -1, 15, 1500, "0 point"), _
  Array("vidange", "", 0, 0, 0, 0, 0, 6000, "TILT, pas de bonus, BILLE 3"), _
  Array("etat", "", 0, 0, 0, 0, 0, 0, "bille 3, plus de tilt"), _
  Array("tir", "bumper", 185, 322, 0, -1, 15, 1500, ""), _
  Array("sauvetage", "", 0, 0, 0, 0, 0, 0, ""), _
  Array("vidange", "", 0, 0, 0, 0, 0, 14000, "fin de partie, record, MATCH"), _
  Array("etat", "", 0, 0, 0, 0, 0, 0, "over ou attract"))
Dim logiqueI : logiqueI = 0
Dim logiqueScore, logiqueMsg, logiqueDetail
Dim logiqueProtege : logiqueProtege = False

Function BillesEnJeu()
  Dim b, n : n = 0
  For Each b In GetBalls : n = n + 1 : Next
  BillesEnJeu = n
End Function

Sub LogiqueEtat()
  Debug.Print "LOGIQUE   etat : mode=" & mode & " bille=" & bille & " billes=" & BillesEnJeu() & " enJeu=" & ballsInPlay & _
    " score=" & score & " mult=" & mult & " bonus=" & bonus & " mbLit=" & mbLit & " multiball=" & multiball & _
    " jackpot=" & jackpot & " jackpotsMb=" & jackpotsMb & " superLit=" & superLit & " escale=" & city & _
    " extraLit=" & extraLit & " tilt=" & tilted & " credits=" & credits & " record=" & highScore
End Sub

Sub LogiqueDepart()
  Debug.Print "LOGIQUE depart"
  StartGame
  Apres 2500, "LogiqueEtape"
End Sub

' la bille de l'essai : la première de la table (les autres, en multiball, roulent librement)
Function BilleEssai()
  Dim lot : lot = GetBalls
  Set BilleEssai = Nothing
  If UBound(lot) >= 0 Then Set BilleEssai = lot(0)
End Function

Sub LogiqueEtape()
  Dim e, b, i
  If logiqueI > UBound(LOGIQUE) Then Debug.Print "LOGIQUE fin" : Exit Sub
  ' bille neuve encore tenue par le distributeur : la déplacer la laisserait bloquée dedans
  If maintenant - logiqueNouvelleT < 1200 Or Distributeur.Enabled Then Apres 300, "LogiqueEtape" : Exit Sub
  e = LOGIQUE(logiqueI)
  logiqueI = logiqueI + 1
  logiqueScore = score : logiqueDetail = "" : logiqueNbContacts = 0
  logiqueProtege = (e(0) = "tir" Or e(0) = "tilt")
  Select Case e(0)
    Case "tir"
      Set b = BilleEssai()
      If b Is Nothing Then Debug.Print "LOGIQUE " & e(1) & " : pas de bille" : Apres 200, "LogiqueEtape" : Exit Sub
      b.X = e(2) / 0.54 : b.Y = e(3) / 0.54 : b.Z = 25
      b.VelX = e(4) * e(6) : b.VelY = e(5) * e(6) : b.VelZ = 0
      b.AngMomX = 0 : b.AngMomY = 0 : b.AngMomZ = 0
      Debug.Print "LOGIQUE tir " & e(1) & " (attendu : " & e(8) & ")"
      Apres e(7), "LogiqueBilan"
    Case "etat"
      Debug.Print "LOGIQUE etat attendu : " & e(8)
      LogiqueEtat
      Apres 100, "LogiqueEtape"
    Case "tilt"
      Debug.Print "LOGIQUE secousse (attendu : " & e(8) & ")"
      HitTilt
      Apres e(7), "LogiqueBilan"
    Case "sauvetage"
      Debug.Print "LOGIQUE attente de la fin du sauvetage de bille"
      LogiqueSauvetage
    Case "vidange"
      Debug.Print "LOGIQUE vidange de toutes les billes (attendu : " & e(8) & ")"
      LogiqueVidange
      Apres e(7), "LogiqueBilan"
  End Select
End Sub

Dim logiqueNbContacts
Sub JournalContact(nom)
  If Not essaiLogique Then Exit Sub
  logiqueNbContacts = logiqueNbContacts + 1
  If logiqueNbContacts <= 4 Then Debug.Print "LOGIQUE     contact " & nom & " t=" & (maintenant Mod 100000) & " x=" & Int(ActiveBall.X * 0.54) & _
    " y=" & Int(ActiveBall.Y * 0.54) & " z=" & Int(ActiveBall.Z) & " vx=" & Round(ActiveBall.VelX, 1) & " vy=" & Round(ActiveBall.VelY, 1)
End Sub

' une bille à la fois posée au-dessus de l'ouverture centrale : elle tombe dans l'évacuation (vrai Drain_Hit)
' (DestroyBall appelé par le script sur une bille autre que la bille active ne la retire pas)
Sub LogiqueVidange()
  Dim lot : lot = GetBalls
  If UBound(lot) < 0 Then Exit Sub
  Debug.Print "LOGIQUE     vidange de la bille x=" & Int(lot(0).X * 0.54) & " y=" & Int(lot(0).Y * 0.54) & " z=" & Int(lot(0).Z) & " vy=" & Round(lot(0).VelY, 1) & " (saucerBusy=" & saucerBusy & ", distributeur=" & Distributeur.Enabled & ")"
  lot(0).X = 240 / 0.54 : lot(0).Y = 1095 / 0.54 : lot(0).Z = 25 : lot(0).VelX = 0 : lot(0).VelY = 3 : lot(0).VelZ = 0
  If UBound(lot) > 0 Then Apres 900, "LogiqueVidange"
End Sub

Dim logiqueNouvelleT : logiqueNouvelleT = -10000
Sub LogiqueNouvelleBille()
  logiqueNouvelleT = maintenant
  Distributeur.Enabled = True : Distributeur.CreateBall : Distributeur.Kick 180, 1
  Apres 400, "CouperDistributeur"
End Sub

Sub LogiqueSauvetage()
  If maintenant < ballSaveUntil Then Apres 500, "LogiqueSauvetage" : Exit Sub
  Apres 100, "LogiqueEtape"
End Sub

' bilan d'une étape, puis la bille d'essai attend dans le couloir du lanceur (immobile, hors jeu)
Sub LogiqueBilan()
  Dim b
  Debug.Print "LOGIQUE   points : " & (score - logiqueScore) & "  [" & Left(logiqueDetail, 240) & " ]  (score " & score & ", mode " & mode & ", billes " & BillesEnJeu() & ")"
  For Each b In GetBalls
    Debug.Print "LOGIQUE     bille x=" & Int(b.X * 0.54) & " y=" & Int(b.Y * 0.54) & " z=" & Int(b.Z) & " vy=" & Round(b.VelY, 1)
  Next
  Set b = BilleEssai()
  If Not b Is Nothing And mode = "play" And Not multiball Then
    b.X = 498 / 0.54 : b.Y = 1050 / 0.54 : b.Z = 25 : b.VelX = 0 : b.VelY = 0 : b.VelZ = 0   ' au-dessus du distributeur
  End If
  Apres 600, "LogiqueEtape"
End Sub

' messages des afficheurs pendant l'essai
Sub LogiqueMessages()
  If msgText <> logiqueMsg Then
    logiqueMsg = msgText
    If msgText <> "" Then Debug.Print "LOGIQUE   message : " & msgText
  End If
End Sub

Function IIf(c, a, b)
  If c Then IIf = a Else IIf = b
End Function

Sub Table1_Exit()
  SaveValue "FannyPinball", "HighScore", highScore
End Sub

' ---------------------------------------------------------------- état de partie et de bille
Sub ResetGame()
  score = 0 : bille = 0 : extraBalls = 0 : extrasGiven = 0 : extraLit = False : replayIdx = 0
  ballsInPlay = 0 : pendingServes = 0 : city = 0 : mbLit = False : multiball = False : mbCount = 0
  fannyDone = 0 : jackpot = JACKPOT_START : jackpotsMb = 0 : superLit = False : carreaux = 0
  ResetBallState
End Sub

Sub ResetBallState()
  Dim i
  mult = 1 : bonus = 0 : pointLit = False : carreauUntil = 0
  For i = 0 To 3 : letters(i) = False : Next
  For i = 0 To 4 : drops(i) = False : Next
  For i = 0 To 2 : targets(i) = False : Next
  ballSaveUntil = 0 : ballSaveArmed = False : autoLaunchNext = False
  saucerBusy = False : tiltWarnings = 0 : tiltIgnoreUntil = 0 : tilted = False : tiltPendule = 0
  RemonterCibles
End Sub

Sub Ajouter(points, b)
  If mode <> "play" Or tilted Then Exit Sub
  If essaiLogique Then logiqueDetail = logiqueDetail & " +" & points
  score = score + points
  bonus = bonus + b
  CheckReplay
End Sub

' ---------------------------------------------------------------- le clac et les crédits
Sub CheckReplay()
  Do While replayIdx <= UBound(REPLAY_LEVELS)
    If score < REPLAY_LEVELS(replayIdx) Then Exit Do
    replayIdx = replayIdx + 1
    FreeGame "PARTIE GRATUITE"
  Loop
End Sub

Sub FreeGame(texte)
  credits = credits + 1 : If credits > MAX_CREDITS Then credits = MAX_CREDITS
  Son SND_CLAC
  If texte = "MATCH" Then Son V_MATCH Else Son V_PARTIE_GRATUITE
  Say texte, 2000
End Sub

Sub FreeGameRecord() : FreeGame "PARTIE GRATUITE" : End Sub

Sub AddCredit()
  credits = credits + 1 : If credits > MAX_CREDITS Then credits = MAX_CREDITS
  Son SND_STANDUP
End Sub

' ---------------------------------------------------------------- partie
Sub StartGame()
  If mode <> "attract" And mode <> "over" Then Exit Sub
  Dim gratuite : gratuite = credits > 0
  If gratuite Then credits = credits - 1
  ResetGame
  matchNum = -1
  mode = "play" : bille = 1
  Son SND_START : Son V_START
  If gratuite Then Say "PARTIE GRATUITE", 3000 Else Say "FANNY PETANQUE WORLD TOUR", 3000
  Musique SND_MUSIQUE_THEME
  PowerOn
  ServeBall False
End Sub

' la bille arrive dans le couloir du lanceur (contact CapteurLanceur) ; auto = lancée par le distributeur
Sub ServeBall(auto)
  ballsInPlay = ballsInPlay + 1
  pendingServes = pendingServes + 1
  If auto Then autoLaunchNext = True
  Distributeur.Enabled = True
  Distributeur.CreateBall
  If auto Then
    Distributeur.Kick 0, KICK_LANCEUR
  Else
    Distributeur.Kick 180, 1
  End If
  Apres 400, "CouperDistributeur"
End Sub
Sub CouperDistributeur() : Distributeur.Enabled = False : End Sub

Sub StartBall()
  ResetBallState
  PowerOn
  ServeBall False
End Sub

Sub EndOfBall()
  mode = "bonus"
  If tilted Then
    bonus = 0
    Say "TILT", 1800
    Apres 1800, "NextBall"
    Exit Sub
  End If
  If mult > 1 Then Say "BONUS X" & mult, 1200 Else Say "BONUS", 1200
  Son SND_BONUS
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
  Son SND_LANE
  Apres 110, "CountBonus"
End Sub

Sub NextBall()
  mode = "play"
  If extraBalls > 0 Then
    extraBalls = extraBalls - 1
    Say "REJOUE", 1500
    StartBall
  ElseIf bille < BALLS_PER_GAME Then
    bille = bille + 1
    Say "BILLE " & bille, 1500
    StartBall
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
  If record Then highScore = score : SaveValue "FannyPinball", "HighScore", highScore
  Son SND_GAME_OVER
  If record Then Say "NOUVEAU RECORD", 2500 : Son V_RECORD Else Say "FIN DE PARTIE", 2500 : Son V_GAME_OVER
  Musique SND_MUSIQUE_GENERIQUE
  If record And ancien > 0 Then
    Apres 2600, "FreeGameRecord"
    Apres 5000, "StartMatch"
  Else
    Apres 2800, "StartMatch"
  End If
End Sub

Sub StartMatch()
  matchRolling = True : matchNum = 0
  Son SND_MATCH
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

' ---------------------------------------------------------------- alimentation des bobines (tilt)
Sub PowerOn()
  Bumper1.Force = 9 : Bumper2.Force = 9 : Bumper3.Force = 9
  LanceG.SlingshotStrength = 80 : LanceD.SlingshotStrength = 80
End Sub

Sub PowerOff()
  Bumper1.Force = 0 : Bumper2.Force = 0 : Bumper3.Force = 0
  LanceG.SlingshotStrength = 0 : LanceD.SlingshotStrength = 0
  LeftFlipper.RotateToStart : RightFlipper.RotateToStart
End Sub

' ---------------------------------------------------------------- clavier
Sub Table1_KeyDown(ByVal keycode)
  If keycode = StartGameKey Then StartGame : Exit Sub
  If keycode = AddCreditKey Or keycode = AddCreditKey2 Then AddCredit : Exit Sub
  If keycode = PlungerKey Then Plunger.PullBack : Exit Sub
  If keycode = LeftTiltKey Then Nudge 90, 2 : Secousse : Exit Sub
  If keycode = RightTiltKey Then Nudge 270, 2 : Secousse : Exit Sub
  If keycode = CenterTiltKey Then Nudge 0, 2 : Secousse : Exit Sub
  If keycode = MechanicalTilt Then HitTilt : Exit Sub
  If keycode = LeftFlipperKey Then
    If mode = "play" And Not tilted Then LeftFlipper.RotateToEnd : PlaySound NomSon(SND_FLIP), 0, 0.6, -0.3 : RotateLetters -1
  End If
  If keycode = RightFlipperKey Then
    If mode = "play" And Not tilted Then RightFlipper.RotateToEnd : PlaySound NomSon(SND_FLIP), 0, 0.6, 0.3 : RotateLetters 1
  End If
End Sub

Sub Table1_KeyUp(ByVal keycode)
  If keycode = PlungerKey Then
    Plunger.Fire
    If shooterClosed Then Son SND_LAUNCH
  End If
  If keycode = LeftFlipperKey Then LeftFlipper.RotateToStart
  If keycode = RightFlipperKey Then RightFlipper.RotateToStart
End Sub

' le pendule : chaque coup de caisse le fait osciller ; trop de coups rapprochés = contact TILT
Sub Secousse()
  PlaySound NomSon(SND_NUDGE)
  If mode <> "play" Then Exit Sub
  tiltPendule = tiltPendule + 1
  If tiltPendule >= 3 Then tiltPendule = 0 : HitTilt
End Sub

Sub HitTilt()
  If mode <> "play" Then Exit Sub
  If tilted Or maintenant < tiltIgnoreUntil Then Exit Sub
  tiltIgnoreUntil = maintenant + TILT_SETTLE_MS
  tiltWarnings = tiltWarnings + 1
  If tiltWarnings <= TILT_WARNINGS Then
    Say "ATTENTION", 1500
    Son SND_STANDUP : Son V_ATTENTION
    Exit Sub
  End If
  tilted = True
  ballSaveUntil = 0 : multiball = False : superLit = False : carreauUntil = 0
  PowerOff
  Son SND_TILT : Son V_TILT
  msgText = ""
End Sub

' ---------------------------------------------------------------- contacts
' tout contact du plateau (hors lanceur) : la bille est en jeu → le sauvetage de bille démarre
Function Contact()
  Contact = False
  If mode = "attract" Or mode = "over" Then Exit Function
  If tilted Then Exit Function
  If Not ballSaveArmed And mode = "play" Then
    ballSaveArmed = True
    If ballSaveUntil < maintenant + BALL_SAVE_MS Then ballSaveUntil = maintenant + BALL_SAVE_MS
  End If
  Contact = True
End Function

Sub CapteurLanceur_Hit()
  shooterClosed = True
  If pendingServes > 0 Then
    pendingServes = pendingServes - 1
    If autoLaunchNext Then autoLaunchNext = False : Apres 500, "LancementAuto"
  End If
End Sub
Sub CapteurLanceur_UnHit() : shooterClosed = False : End Sub

Sub LancementAuto()
  If Not shooterClosed Then Exit Sub
  Son SND_LAUNCH
  Plunger.AutoPlunger = True : Plunger.Fire : Plunger.AutoPlunger = False
End Sub

Sub Drain_Hit()
  If essaiLogique Then Debug.Print "LOGIQUE     Drain_Hit x=" & Int(ActiveBall.X * 0.54) & " y=" & Int(ActiveBall.Y * 0.54) & " protege=" & logiqueProtege & " billes=" & BillesEnJeu()
  If logiqueProtege Then                    ' essai de la logique : une bille neuve au lanceur au lieu de la bille perdue
    ActiveBall.DestroyBall                  ' (déplacée sans être retirée, vpinball la croirait encore dans l'évacuation)
    Debug.Print "LOGIQUE   (bille évacuée, remplacée au lanceur)"
    If multiball And ballsInPlay > 1 Then     ' en multiball : une bille de moins, sans rien servir
      ballsInPlay = ballsInPlay - 1
    Else
      Apres 100, "LogiqueNouvelleBille"       ' hors de l'évènement de collision
    End If
    Exit Sub
  End If
  ActiveBall.DestroyBall
  If essaiLogique Then Debug.Print "LOGIQUE     apres DestroyBall billes=" & BillesEnJeu()
  BilleEvacuee
End Sub

Sub BilleEvacuee()
  ballsInPlay = ballsInPlay - 1 : If ballsInPlay < 0 Then ballsInPlay = 0
  If mode <> "play" Then Exit Sub
  If tilted Then
    If ballsInPlay = 0 Then Son SND_DRAIN : EndOfBall
    Exit Sub
  End If
  If Not ballSaveArmed And Not multiball Then
    Say "BILLE RENDUE", 1200
    ServeBall False
    Exit Sub
  End If
  If maintenant < ballSaveUntil Then
    Say "FANNY TE LA REND", 1500
    Son SND_BALL_SAVE : Son V_BALL_SAVE
    ServeBall True
    Exit Sub
  End If
  If multiball And ballsInPlay <= 1 Then
    multiball = False : superLit = False
    Say "FIN DE LA MENE", 1500
  End If
  If ballsInPlay = 0 Then Son SND_DRAIN : Son V_DRAIN : EndOfBall
End Sub

' --- couloirs du haut : T O U R
' anti-rebond des contacts : vpinball peut signaler le même passage d'une bille des dizaines de fois dans le même pas
' de physique (essai -c1 logique : un couloir comptait 300 x 47) ; un contact ne compte qu'une fois par 150 ms, comme
' l'anti-rebond des contacts de la réplique.
Dim dernierCoup(16)
Function Doublon(k)
  Doublon = (GameTime - dernierCoup(k) < 150)
  If Not Doublon Then dernierCoup(k) = GameTime
End Function

Sub CouloirT_Hit() : If Not Doublon(0) Then HitLane 0
End Sub
Sub CouloirO_Hit() : If Not Doublon(1) Then HitLane 1
End Sub
Sub CouloirU_Hit() : If Not Doublon(2) Then HitLane 2
End Sub
Sub CouloirR_Hit() : If Not Doublon(3) Then HitLane 3
End Sub

Sub HitLane(i)
  JournalContact "couloir " & i
  If Not Contact() Then Exit Sub
  Ajouter 300, 30
  If LightLetter(i) Then Son SND_LANE
End Sub

Function LightLetter(i)
  LightLetter = False
  If letters(i) Then Exit Function
  letters(i) = True
  LightLetter = True
  If Not (letters(0) And letters(1) And letters(2) And letters(3)) Then Exit Function
  Dim k : For k = 0 To 3 : letters(k) = False : Next
  If mult < MAX_MULT Then
    mult = mult + 1
    Say "BONUS X" & mult, 1800
    Son V_BONUS_MULT
    If mult = MAX_MULT Then LightExtra
  Else
    Ajouter 10000, 0
    Say "10000", 1200
  End If
  Son SND_LANES_DONE
End Function

Sub RotateLetters(dir)
  Dim t(3), i
  For i = 0 To 3 : t(i) = letters((i - dir + 4) Mod 4) : Next
  For i = 0 To 3 : letters(i) = t(i) : Next
End Sub

' --- couloirs du bas
Sub Bas_outL_Hit() : If Not Doublon(4) Then CouloirBas True
End Sub
Sub Bas_outR_Hit() : If Not Doublon(5) Then CouloirBas True
End Sub
Sub Bas_inExtL_Hit() : If Not Doublon(6) Then CouloirBas False
End Sub
Sub Bas_inIntL_Hit() : If Not Doublon(7) Then CouloirBas False
End Sub
Sub Bas_inIntR_Hit() : If Not Doublon(8) Then CouloirBas False
End Sub
Sub Bas_inExtR_Hit() : If Not Doublon(9) Then CouloirBas False
End Sub

Sub CouloirBas(dehors)
  JournalContact "couloir bas"
  If Not Contact() Then Exit Sub
  If dehors Then Ajouter 1000, 200 Else Ajouter 500, 100
  Son SND_LANE
End Sub

' --- bumpers et lance-pierres
Sub Bumper1_Hit() : HitBumper : End Sub
Sub Bumper2_Hit() : HitBumper : End Sub
Sub Bumper3_Hit() : HitBumper : End Sub
Sub HitBumper()
  If Not Contact() Then Exit Sub
  Ajouter 100, 10 : Son SND_BUMPER
End Sub

Sub LanceG_Slingshot() : HitSling : End Sub
Sub LanceD_Slingshot() : HitSling : End Sub
Sub HitSling()
  If Not Contact() Then Exit Sub
  Ajouter 10, 10 : Son SND_SLING
End Sub

Sub Tourniquet_Spin()
  If Not Contact() Then Exit Sub
  If multiball Then Ajouter 1000, 25 Else Ajouter 250, 25
  PlaySound NomSon(SND_STANDUP), 0, 0.15
End Sub

' --- jeu de boules : trois cibles rondes du mur gauche = TRIPLETTE
Sub Boule1_Hit() : If Not Doublon(11) Then HitTarget 0
End Sub
Sub Boule2_Hit() : If Not Doublon(12) Then HitTarget 1
End Sub
Sub Boule3_Hit() : If Not Doublon(13) Then HitTarget 2
End Sub
Sub HitTarget(i)
  If Not Contact() Then Exit Sub
  Ajouter 300, 30 : Son SND_STANDUP
  If targets(i) Then Exit Sub
  targets(i) = True
  If Not (targets(0) And targets(1) And targets(2)) Then Exit Sub
  targets(0) = False : targets(1) = False : targets(2) = False
  Ajouter 3000, 300
  Say "TRIPLETTE", 1500
  Son V_TRIPLETTE : Son SND_LANES_DONE
  pointLit = True
End Sub

Sub Pointer_Hit()
  If Doublon(14) Then Exit Sub
  If Not Contact() Then Exit Sub
  Ajouter 500, 50 : Son SND_STANDUP
  pointLit = True
End Sub

Sub Bouchon_Hit()
  If Doublon(16) Then Exit Sub
  If Not Contact() Then Exit Sub
  Ajouter 1500, 150 : Son SND_STANDUP
  If pointLit Then
    pointLit = False
    Ajouter 5000, 500
    Say "BIBERON", 1500 : Son V_BIBERON
  Else
    Say "TIR AU BOUCHON", 1500 : Son V_BOUCHON
  End If
  carreauUntil = maintenant + CARREAU_MS
End Sub

Sub Tirer_Hit()
  If Doublon(15) Then Exit Sub
  If Not Contact() Then Exit Sub
  If maintenant < carreauUntil Then
    carreauUntil = 0
    carreaux = carreaux + 1
    Dim pts : pts = CARREAU_PTS * carreaux
    Ajouter pts, 1000
    Say "CARREAU " & pts, 1800
    Son SND_JACKPOT : Son V_CARREAU
    Exit Sub
  End If
  Ajouter 500, 50 : Son SND_STANDUP
End Sub

' --- F A N N Y : cibles tombantes
Sub DT_F_Hit() : HitDrop 0 : End Sub
Sub DT_A_Hit() : HitDrop 1 : End Sub
Sub DT_N1_Hit() : HitDrop 2 : End Sub
Sub DT_N2_Hit() : HitDrop 3 : End Sub
Sub DT_Y_Hit() : HitDrop 4 : End Sub

Sub HitDrop(i)
  If Not Contact() Then Exit Sub
  If drops(i) Then Exit Sub
  drops(i) = True
  Ajouter 500, 50 : Son SND_DROP
  If Not (drops(0) And drops(1) And drops(2) And drops(3) And drops(4)) Then Exit Sub
  Son SND_DROPS_DONE
  If multiball Then
    jackpot = jackpot + 2 * JACKPOT_STEP
    Say "JACKPOT " & jackpot, 1800
  ElseIf Not mbLit Then
    fannyDone = fannyDone + 1
    Dim besoin : besoin = mbCount + 1
    If fannyDone >= besoin Then
      fannyDone = 0 : mbLit = True
      Say "MULTIBALL AU CERCLE", 2200 : Son V_MB_LIT
    Else
      Ajouter 5000, 500
      Say "FANNY " & fannyDone & "/" & besoin, 1500
    End If
  Else
    Ajouter 5000, 500
  End If
  Apres 1000, "RemonterCibles"
End Sub

Sub RemonterCibles()
  Dim i : For i = 0 To 4 : drops(i) = False : Next
  DT_F.IsDropped = False : DT_A.IsDropped = False : DT_N1.IsDropped = False : DT_N2.IsDropped = False : DT_Y.IsDropped = False
End Sub

' --- le Cercle : la bille est toujours réexpulsée. Priorité : multiball, super jackpot, extra ball
Sub Cercle_Hit()
  If saucerBusy Then Exit Sub
  saucerBusy = True
  Dim hold : hold = 1000
  If mode <> "play" Or tilted Then
    hold = 600
  ElseIf mbLit And Not multiball Then
    Contact
    Say "TRIPLETTE MULTIBALL", 2500
    Son SND_MULTIBALL : Son V_MULTIBALL
    hold = 2000
    Apres hold, "StartMultiball"
  ElseIf multiball And superLit Then
    Contact
    superLit = False : jackpotsMb = 0
    Ajouter 3 * jackpot, 0
    Say "SUPER JACKPOT " & (3 * jackpot), 2500
    Son SND_JACKPOT : Son V_SUPER_JACKPOT
    hold = 1800
  ElseIf extraLit Then
    Contact
    extraLit = False
    AwardExtra
    hold = 1800
  Else
    Contact
    Ajouter 1000, 100 : Son SND_SAUCER
  End If
  Apres hold, "EjecterCercle"
End Sub

Sub EjecterCercle()
  Cercle.Kick 242 + Int(Rnd * 6), 12
  PlaySound NomSon(SND_SLING)
  saucerBusy = False
End Sub

Sub StartMultiball()
  multiball = True : mbLit = False : mbCount = mbCount + 1
  jackpotsMb = 0 : superLit = False
  ballSaveUntil = maintenant + MB_BALL_SAVE_MS
  ServeBall True
  Apres 1500, "ServeAuto"
End Sub
Sub ServeAuto() : ServeBall True : End Sub

' --- extra ball : allumée au Cercle (TOUR au ×5) ou donnée directement (Grand Chelem)
Sub LightExtra()
  If extraLit Then Exit Sub
  If extrasGiven >= EXTRA_MAX Then Ajouter EXTRA_POINTS, 0 : Exit Sub
  extraLit = True
  Apres 1900, "AnnonceExtra"
End Sub
Sub AnnonceExtra() : Say "EXTRA BALL AU CERCLE", 2200 : Son V_EXTRA_LIT : End Sub

Sub AwardExtra()
  If extrasGiven >= EXTRA_MAX Then
    Ajouter EXTRA_POINTS, 0
    Say CStr(EXTRA_POINTS), 1500
    Exit Sub
  End If
  extrasGiven = extrasGiven + 1
  extraBalls = extraBalls + 1
  Say "EXTRA BALL", 2000
  Son SND_EXTRA : Son V_EXTRA
End Sub

' --- rampe : escales du World Tour, jackpot en multiball
Sub CapteurRampe_Hit()
  ' le capteur est un volume posé sur le plateau : une bille qui passe dessous, sur le plateau, ne compte pas
  If ActiveBall.Z < 55 Then Exit Sub
  If Doublon(10) Then Exit Sub
  If GetCustomParam(1) = "rampe" Then Debug.Print "RAMPE   capteur de rampe : passage réussi"
  If Not Contact() Then Exit Sub
  Ajouter 2000, 200
  If multiball Then
    Ajouter jackpot, 0
    Say "JACKPOT " & jackpot, 1800
    jackpot = jackpot + JACKPOT_STEP
    Son SND_JACKPOT : Son V_JACKPOT
    jackpotsMb = jackpotsMb + 1
    If jackpotsMb >= SUPER_AFTER And Not superLit Then superLit = True : Apres 1900, "AnnonceSuper"
  Else
    Son SND_RAMP
  End If
  city = city + 1
  If city > UBound(CITIES) Then
    city = 0
    Ajouter 50000, 5000
    Say "GRAND CHELEM", 2500
    Son SND_GRAND_CHELEM : Son V_GRAND_CHELEM
    Apres 2500, "AwardExtra"
  Else
    If Not multiball Then Say CITIES(city), 1500
    Son SND_CITY
    If Not multiball Then Son V_CITY_1 + city - 1
  End If
End Sub
Sub AnnonceSuper() : Say "SUPER JACKPOT AU CERCLE", 2200 : End Sub

' ---------------------------------------------------------------- horloge (20 ms) : minuteries, lampes, afficheurs
Dim dernierPendule : dernierPendule = 0
Dim essaiLogique : essaiLogique = False
Sub Horloge_Timer()
  maintenant = GameTime
  Dim i, a
  For i = 0 To NB_MIN - 1
    If minOn(i) Then
      If minT(i) <= maintenant Then minOn(i) = False : Set a = minA(i) : Call a()
    End If
  Next
  If msgText <> "" And maintenant > msgUntil Then msgText = ""
  If maintenant - dernierPendule > 1000 Then dernierPendule = maintenant : If tiltPendule > 0 Then tiltPendule = tiltPendule - 1
  MajLampes
  Afficheurs
  If essaiLogique Then LogiqueMessages
End Sub

Function B2E(b)
  If b Then B2E = 1 Else B2E = 0
End Function

Sub MajLampes()
  Dim i, k, e(31)
  For i = 0 To 3 : e(i) = B2E(letters(i)) : Next
  For i = 0 To 4 : e(4 + i) = B2E(drops(i)) : Next
  If superLit Then
    e(9) = 2
  ElseIf multiball Then
    e(9) = 1
  ElseIf mbLit Then
    e(9) = 2
  Else
    e(9) = 0
  End If
  e(10) = 1
  If multiball Then e(11) = 2 Else e(11) = 0
  For i = 0 To 6
    If i < city Then
      e(12 + i) = 1
    ElseIf i = city Then
      e(12 + i) = 2
    Else
      e(12 + i) = 0
    End If
  Next
  For i = 2 To 5 : e(17 + i) = B2E(mult >= i) : Next
  e(23) = B2E(extraBalls > 0)
  If maintenant < ballSaveUntil Then e(24) = 2 Else e(24) = 0
  If maintenant < carreauUntil Then e(25) = 2 Else e(25) = 0
  If pointLit Then e(26) = 2 Else e(26) = 1
  e(27) = B2E(pointLit)
  For i = 0 To 2 : e(28 + i) = B2E(targets(i)) : Next
  If extraLit Then e(31) = 2 Else e(31) = 0
  If tilted Then
    For i = 0 To 31 : e(i) = 0 : Next
  End If
  If mode = "attract" Or mode = "over" Or mode = "match" Then
    k = Int(maintenant / 150)
    For i = 0 To 31 : e(i) = B2E((i + k) Mod 6 = 0) : Next
  End If
  For i = 0 To 31
    If lampEtat(i) <> e(i) Then lampEtat(i) = e(i) : lampObj(i).State = e(i)
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
        s = ScrollText("FANNY PETANQUE WORLD TOUR", 8, maintenant Mod 6000)
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
      info = "BILLE " & bille & "   BONUS X" & mult
    End If
  End If
  DessinerAfficheur s, UCase(info)
End Sub

' ---------------------------------------------------------------- afficheur à points (DMD 128 x 32)
' Le VPX de la Batocera ne dessine pas le texte des boîtes de texte : on calcule les points, police 5 x 7
' (5 colonnes par caractère, bit 0 = rangée du haut) ; score en double taille, ligne d'info dessous.
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
' couleurs des points allumés (afficheur en couleurs : DMDColoredPixels, pleine luminosité)
Dim DMD_SCORE : DMD_SCORE = RGB(255, 150, 40)
Dim DMD_INFO : DMD_INFO = RGB(255, 200, 90)
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
  t = RTrim(s)
  DmdTexte s, Int((DMD_L - Len(s) * 12) / 2) + 1, 2, 2, DMD_SCORE
  t = Trim(info)
  DmdTexte t, Int((DMD_L - Len(t) * 6) / 2) + 1, 23, 1, DMD_INFO
  DMDWidth = DMD_L : DMDHeight = DMD_H
  DMDColoredPixels = dmdPoints
End Sub
