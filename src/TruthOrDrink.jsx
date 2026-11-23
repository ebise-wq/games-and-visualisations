import { useState } from "react";

const MILD_QUESTIONS = [
  "What was middle school/high school like for you?",
  "What really feels like freedom to you?",
  "What are you nostalgic for?",
  "What's something that generates a lot of nostalgia for you?",
  "Would you rather dance alone or with other people? What does this say about you?",
  "Largest animal you've had a confrontation with? (Excluding humans)",
  "What do you appreciate about the opposite gender?",
  "What was the last real letter you've sent someone? What did it say?",
  "Terrible gift you received?",
  "Great gift you received?",
  "What is a compliment you received that you still cherish?",
  "What's your favorite memory?",
  "What's something you dream of regularly (in your sleep)?",
  "What's an ostensibly normal word you really dislike?",
  "Have you ever been to a school reunion? What was it like?",
  "What is a book that really improved your understanding of the world?",
  "Which tasks are very aversive to you? Why?",
  "When was the last time you did something you were afraid of?",
  "Who's someone you see as a role model/inspiration to you?",
  "What's a risk you took in love that really paid off?",
  "What's the craziest thing you've done for love?",
  "What are you currently procrastinating?",
  "Which personality trait is really important for you for a romantic partner to have?",
  "Which personality trait of yours has been a conscious decision?",
  "What is a memorable moment where you learned something important about who you are?",
  "What is a skill you improved over the last year?",
  "What's a skill that you've been plateauing on? What could you do to break the impasse?",
  "What's a life skill you think you'll never possess?",
  "What's something you wish people had told you sooner?",
  "How do you feel in crowds?",
  "What's your type?",
  "What's the first thing you notice when you meet a person?",
  "What's your favorite thing you own and why?",
  "How important is it for you to have a long-term romantic partner?",
  "What is something men can wear to look sexy?",
  "A life with your romantic soul mate but zero friends, or a life with no romantic relationship ever, but you can make as many friends as you want?",
  "What are your top 3 values?",
  "What do you really think of me?",
  "What was your first impression of me?",
  "What do you find to be my most attractive feature?",
  "What's a piece of feedback you received that you're really grateful for?",
  "What is something you did well today?",
  "What hobby is a red/yellow flag to you?",
  "How have you grown?",
  "What is something you're proud of?",
  "What is a really beautiful thing you've been told?",
  "Describe your ideal second date",
  "How would you change modern dating norms?",
  "What's a secret skill or talent you have that most people don't know about?",
  "What's something you're curious about but haven't explored yet?",
  "How do you define success for yourself?",
  "If you could have one superpower, what would it be and how would you use it?",
  "What's a personality trait you have that's both a strength and a weakness?",
  "When was the last time you were brave?",
  "What did your parents do right?",
  "Are you wholesome?",
  "What makes (your) life meaningful?",
  "What's a change that happened in your life that made people treat you differently?",
  "Do you think of yourself as a woman/man/adult, or as a girl/boy?",
  "What age do you see yourself as?",
  "What in your life is spiritual?",
  "Describe one of your most spiritual experiences",
  "If you could know the exact date of your death, would you want to know?",
  "If you could have dinner with anyone, living or dead, who would it be and what would you ask them?",
  "What's a belief you had five years ago that you no longer hold today?",
  "If you could experience life as any animal, which would you choose and for how long?",
  "How do you think your friends would describe you when you're not around?",
  "What is your life story in one minute?",
  "What is your relationship with money?",
  "What is your relationship with ambition?",
  "What is your relationship with nature?",
  "How politically diverse are your friends?",
  "If you could be someone else and live their life for a day, who would you choose?",
  "If you could do your life over, would you? Which age would you start at?",
  "If you could go back in time and talk to yourself, which time would you go to and what would you say?",
  "What's a choice in your life that turned out very well?",
  "What is something I wouldn't easily guess about you?",
  "If you could take a drug that would enhance muscle growth without side effects, would you take it?",
  "If you were in love with a mermaid/merman, and had the option to transform for them, would you?",
  "If you could double your healthy lifespan, would you do it? Would you want it for society?",
  "What's one piece of relationship advice you'd give your children?",
  "So, any good drama lately?",
  "Polyamory or monoamory? Why?",
];

const MODERATE_QUESTIONS = [
  "If you dated a trans person, (when) would you like to know? Why?",
  "What's a difficult piece of feedback you've received?",
  "Talk about a time you got duped.",
  "On a scale from 0 to 10, how much do you discriminate based on looks? Do you endorse that?",
  "What do you struggle to tolerate?",
  "What was your relationship with your father like when you were a child?",
  "What was your relationship with your mother like when you were a child?",
  "Which trait have you inherited from your maternal grandparents?",
  "Which trait have you inherited from your paternal grandparents?",
  "What is the religious-cultural background of your family?",
  "What is something about which you prefer to be lied to?",
  "Are you good at changing your behavior?",
  "What do you like most about being in a committed romantic relationship?",
  "What do you like least about being in a committed relationship?",
  "Which medications are you on?",
  "How would you want to raise your children?",
  "What would be difficult for you personally in raising children?",
  "Do you feel whole or is there something missing inside of you?",
  "How are you, really?",
  "Pick something randomly from your notes and read it to the other person",
  "What is something difficult you've come to accept?",
  "What's something about life that you haven't accepted (yet)?",
  "Which drugs have you seen in real life?",
  "What is a controversial opinion you have?",
  "How attractive would you rate yourself on a scale of 1-7? (4 = average)",
  "What do you find attractive about the other person?",
  "What is a bad habit that you've been struggling with?",
  "What did your parents do wrong?",
  "What about your body are you insecure about?",
  "Do you feel seen?",
  "Did you feel seen much when you grew up?",
  "Who was the first person to make you feel seen?",
  "Can men and women be just friends if they are both single, straight, and not unattractive?",
  "Your best friend has been cheating on their partner. You know their partner well. What do you do?",
  "Do you think you're better than other people? Be honest.",
  "What have you been afraid of?",
  "What is a really painful thing you've been told?",
  "In what way have you changed for the worse?",
  "What is one of your biggest mistakes?",
  "What is something you're ashamed about?",
  "What red flag have you ignored?",
  "Why did your past relationships fail?",
  "Why did your last relationship fail?",
  "In your next relationship, what about you will bother your partner?",
  "When was the last time your heart was broken? What happened?",
  "What did you learn from your last breakup?",
  "What is something you still need therapy for?",
  "What's something you've done that you're certain you'd never do again?",
  "What's the hardest moral decision you've ever had to make?",
  "Is there anything you consider too personal to share with a romantic partner?",
  "What's something you wish more people understood about you?",
  "What's your most unpopular opinion about relationships?",
  "When was the last time you felt truly vulnerable with someone?",
  "What's a question you're afraid to know the answer to?",
  "Would you rather be extremely successful but lonely, or average but surrounded by people who love you?",
  "If you could change one decision in your past, what would it be?",
  "What's the most significant lesson a past relationship has taught you?",
  "How do you relate to depressed people?",
  "When was the last time you cried? What did you cry about?",
  "Have you ever bullied someone?",
  "What is your relationship to drugs?",
  "If you were paid 1000 euro to take heroin, would you do it? If not, for what price?",
  "Largest amount of material damage you've done?",
  "Your partner had an emotional affair years ago during a difficult period. Would you want to know?",
  "If you could clone yourself as an identical copy, would you do it?",
  "Should children be genetically engineered?",
  "Would you take a pill that made you feel perpetually happy but slightly disconnected from reality?",
  "What do you think happens after death?",
  "If you could read minds for a day, how would you use it?",
  "What is a relationship deal-breaker that you've discovered about yourself?",
  "What is your relationship with death like?",
  "What is your relationship with the dark side of life?",
  "What is your relationship with the light side of life?",
  "What does the voice in your head often say?",
  "On a scale of 0-10, how much do you wish your partner would modify their looks?",
  "Can a romantic partner ask you to change your hair style or facial hair?",
  "Would you be willing to change your hair style/facial hair for your partner?",
  "What's your biggest battle?",
  "What's a choice in your life that turned out very badly?",
  "What do you like the most about your own personality?",
  "What do you like the least about your own personality?",
  "What was the last thing you were wrong about?",
  "Can I see your TikTok/Shorts/Reels algorithm?",
  "What's your drug of choice?",
  "Describe a crazy drug experience you've had (alcohol and caffeine count)",
  "Describe a beautiful drug experience you've had (alcohol and caffeine count)",
  "What's something you've always wanted to try in bed but been too afraid to ask for?",
  "How much can men be blamed for premature ejaculation?",
];

const SPICY_QUESTIONS = [
  "Imitate what you think the other person sounds like having sex",
  "How do you like consent to be incorporated in sex?",
  "When was the last time you tested for an STD? What did you test?",
  "What kind of safety rules do you follow for new sexual encounters?",
  "Have you ever bought a sex toy? What was the last one you bought?",
  "How often would you ideally have sex with a partner, and what time of day?",
  "What's an acceptable risk level of getting pregnant from a sexual encounter?",
  "What is the ideal body count of your romantic partner? What if above 100?",
  "Do you remember your first orgasm?",
  "What is a sexual fantasy of yours? Would you like it to actually happen?",
  "How good are you at sexually fantasizing?",
  "What's holding you back from having more sex?",
  "What's a common thing people do during sex that you don't really enjoy?",
  "What would you change about your sexual anatomy/biology?",
  "What's a turn on for you?",
  "What's a turn off for you?",
  "Do you often have spontaneous desire, or is it mostly responsive desire?",
  "If you could instantly transform into the opposite sex temporarily, how long would you do it for?",
  "Describe your first kiss",
  "Kissing, holding hands, having sex. How close together should these be during dating, and in what order?",
  "Describe your first time having sex",
  "When is the ideal time during dating to have sex?",
  "Have you ever fantasized about me/someone in this group/room?",
  "What is a sexual kink you have?",
  "Dom or sub?",
  "Fuck, marry, befriend: different ethnicities",
  "When was the last time you masturbated? What did you do and how was it?",
  "What is one piece of advice on sex you would give the opposite sex?",
  "What is something you can still improve on in the bedroom?",
  "What's your relationship to porn like?",
  "What kind of porn do you tend to search for, if you watch it?",
  "How kinky are you on a scale from 1-10?",
  "Does a long-term romantic partner come first in your relationship hierarchy?",
  "Have you ever cheated in a relationship? How was it dealt with?",
  "Have you ever been cheated on? How did you deal with it?",
  "Is cheating the definitive end to a relationship?",
  "Is sex with animals inherently morally wrong? What if the animal enjoys it?",
  "Should AI-generated CP be banned?",
  "Describe one of your best sexual experiences",
  "Women giving anal sex to men: yay or nay?",
  "What is your relationship to sex?",
  "The most immoral thing you've ever done?",
  "What's the most unconventional place you've had sex or would like to?",
  "If you could switch bodies with your partner during sex, would you?",
  "What's a sexual fantasy you've never told anyone about before?",
  "Amazing sexual chemistry but no emotional connection, or deep emotional connection with mediocre sex?",
  "What's something you pretended to enjoy in bed but actually didn't?",
  "Have you ever faked an orgasm? Why or why not?",
  "What's the boldest thing you've ever done to initiate sex with someone?",
  "If you could safely try any kink or fetish without judgment, what would you explore?",
  "What's the longest you've gone without sex when in a relationship, and why?",
  "What's your opinion on watching porn together with a partner?",
  "Would you rather have sex with the lights on or off, and what does that say about you?",
  "Have you ever been attracted to someone you know you shouldn't be attracted to?",
  "Threesome: yes, no, or maybe? What's your reasoning?",
  "What's something sexual you used to be uncomfortable with but now enjoy?",
  "What's your favorite form of foreplay to give and to receive?",
  "What sexual experience has had the biggest impact on how you view sex now?",
  "How important is sexual compatibility in a relationship for you, on a scale of 1-10?",
  "What was your most embarrassing sexual moment?",
  "When it comes to sexting, are you more comfortable sending or receiving?",
  "What's something a past partner did that you miss in current sexual relationships?",
  "Would you rather never give oral sex again or never receive it again?",
  "What's your honest opinion about friends with benefits situations?",
];

const TRIGGER_QUESTIONS = [
  "Have you ever considered suicide?",
  "Have you ever experienced sexual assault/violence?",
  "What's the most dangerous thing you've experienced?",
  "What's a trauma of yours?",
];

const MILD_DARES = [
  "Will you do the nose eskimo kiss with the other person?",
  "Give the other person a palm reading. Improvise!",
  "Demonstrate your go-to dance move when no one's watching.",
  "Allow another player to put makeup on you while blindfolded.",
  "Do your best impression of another player for the next three questions.",
  "Let another player give you a new hairstyle for the rest of the game.",
  "Let the group dress you up in the most outrageous outfit from available clothing.",
  "Let another player blindfold you and feed you something of their choice.",
  "Exchange an item of clothing with another player until the end of the game.",
];

const MODERATE_DARES = [
  "Call the third person in your recent contacts and tell them something you've always wanted to say.",
  "Let someone go through your phone for 1 minute while you can't interfere.",
  "Take off an article of clothing and play the next three rounds without it.",
  "Show your dating app history to the group for 3 minutes",
  "Allow the group to create a sexy photo of you (fully clothed) that stays on your phone for a week.",
  "While blindfolded, guess objects placed against your belly without using your hands.",
  "Give someone else in the room a massage for two minutes. (Ask their consent)",
  "Blindfolded, identify someone just by touch among other players.",
];

const SPICY_DARES = [
  "Ask another person: will you sit on my lap and look into my eyes for 2 minutes?",
  "Will you kiss the other/another person right now? (With their consent)",
  "Ask another person: if you could ask me to touch you for a minute, how? (Consent required)",
  "Ask another person: if you could touch me for one minute, how would you? (Consent required)",
  "Let someone trace a word on your inner thigh with their finger - guess what it is.",
  "Whisper something suggestive in another player's ear that would make them blush.",
  "Make out with your own hand in the most convincing way possible for 15 seconds.",
  "Give a detailed description of what you think the person to your left would be like in bed.",
  "Show your favorite 3 sex positions, but you're the opposite party",
  "Play seven minutes in heaven with someone of the group's choosing. (They need to consent)",
  "Do a striptease to music",
  "Take an ice cube in your mouth and pass it to another person (ask consent)",
  "Demonstrate your favorite sex position using pillows/props without saying a word.",
  "Call your crush and confess your feelings",
];

const SPICE = {
  mild: { bg: "#2d6a4f", text: "#b7e4c7", emoji: "\uD83D\uDE0A", label: "Mild" },
  moderate: { bg: "#b5651d", text: "#fde68a", emoji: "\uD83D\uDE2C", label: "Moderate" },
  spicy: { bg: "#9d0208", text: "#fca5a5", emoji: "\uD83E\uDD75", label: "Spicy" },
  trigger: { bg: "#4a044e", text: "#e9d5ff", emoji: "\u26A0\uFE0F", label: "TW" },
};

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function buildDeck(lvls, tw, dares) {
  let d = [];
  if (lvls.includes("mild")) {
    d.push(...MILD_QUESTIONS.map(t => ({ text: t, type: "truth", spice: "mild" })));
    if (dares) d.push(...MILD_DARES.map(t => ({ text: t, type: "dare", spice: "mild" })));
  }
  if (lvls.includes("moderate")) {
    d.push(...MODERATE_QUESTIONS.map(t => ({ text: t, type: "truth", spice: "moderate" })));
    if (dares) d.push(...MODERATE_DARES.map(t => ({ text: t, type: "dare", spice: "moderate" })));
  }
  if (lvls.includes("spicy")) {
    d.push(...SPICY_QUESTIONS.map(t => ({ text: t, type: "truth", spice: "spicy" })));
    if (dares) d.push(...SPICY_DARES.map(t => ({ text: t, type: "dare", spice: "spicy" })));
  }
  if (tw) d.push(...TRIGGER_QUESTIONS.map(t => ({ text: t, type: "truth", spice: "trigger" })));
  return shuffle(d);
}

export default function App() {
  const [phase, setPhase] = useState("setup");
  const [lvls, setLvls] = useState(["mild"]);
  const [tw, setTw] = useState(false);
  const [dares, setDares] = useState(true);
  const [deck, setDeck] = useState([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const tog = function(l) { setLvls(function(p) { return p.includes(l) ? p.filter(function(x) { return x !== l; }) : p.concat([l]); }); };

  const start = function() {
    if (!lvls.length) return;
    setDeck(buildDeck(lvls, tw, dares));
    setIdx(0);
    setRevealed(false);
    setPhase("play");
  };

  const next = function() {
    if (idx < deck.length - 1) {
      setIdx(idx + 1);
      setRevealed(false);
    } else {
      setPhase("done");
    }
  };

  var deckSize = buildDeck(lvls, tw, dares).length;

  if (phase === "setup") {
    return (
      <div style={S.wrap}>
        <div style={S.setup}>
          <h1 style={S.title}>
            {"Truth "}
            <span style={S.or}>{"or"}</span>
            {" Dare "}
            <span style={S.or}>{"or"}</span>
            {" Drink "}
            <span style={S.or}>{"or"}</span>
            {" Toke"}
          </h1>
          <p style={S.sub}>{"Voor Justin \u2014 omdat je nooit genoeg vragen kan stellen"}</p>

          <div style={S.sec}>
            <h3 style={S.secT}>{"SPICE LEVEL"}</h3>
            <div style={S.row}>
              {["mild", "moderate", "spicy"].map(function(l) {
                var c = SPICE[l];
                var on = lvls.includes(l);
                return (
                  <button key={l} onClick={function() { tog(l); }} style={{
                    padding: "10px 18px", borderRadius: 99, fontSize: 15, cursor: "pointer",
                    fontFamily: "inherit", transition: "all 0.2s",
                    background: on ? c.bg : "#1a1a2e",
                    color: on ? c.text : "#666",
                    border: on ? "2px solid " + c.text : "2px solid #333",
                  }}>
                    {c.emoji + " " + c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={S.sec}>
            <h3 style={S.secT}>{"OPTIONS"}</h3>
            <label style={S.lbl}>
              <input type="checkbox" checked={dares} onChange={function() { setDares(!dares); }} style={S.cb} />
              {"Include dares"}
            </label>
            <label style={S.lbl}>
              <input type="checkbox" checked={tw} onChange={function() { setTw(!tw); }} style={S.cb} />
              {"Include trigger warning questions"}
            </label>
          </div>

          <button onClick={start} disabled={!lvls.length} style={{
            width: "100%", padding: 16, fontSize: 18, fontWeight: 700,
            background: "linear-gradient(135deg, #e8a838, #c2185b)",
            color: "#fff", border: "none", borderRadius: 12, cursor: "pointer",
            marginTop: 16, fontFamily: "inherit",
            opacity: lvls.length ? 1 : 0.4,
          }}>
            {"Start Game (" + deckSize + " cards)"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div style={S.wrap}>
        <div style={S.setup}>
          <h1 style={S.title}>{"That's all!"}</h1>
          <p style={S.sub}>{"You went through " + (idx + 1) + " cards. Hope you had fun."}</p>
          <button onClick={function() { setPhase("setup"); }} style={{
            width: "100%", padding: 16, fontSize: 18, fontWeight: 700,
            background: "linear-gradient(135deg, #e8a838, #c2185b)",
            color: "#fff", border: "none", borderRadius: 12, cursor: "pointer",
            marginTop: 16, fontFamily: "inherit",
          }}>
            {"Play Again"}
          </button>
        </div>
      </div>
    );
  }

  var cur = deck[idx];
  var sc = SPICE[cur.spice];
  var isDare = cur.type === "dare";

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <button onClick={function() { setPhase("setup"); }} style={S.back}>{"< Settings"}</button>
        <span style={{ color: "#666", fontSize: 14 }}>{(idx + 1) + " / " + deck.length}</span>
      </div>

      <div
        onClick={function() { if (!revealed) setRevealed(true); }}
        style={{
          width: "100%", maxWidth: 480, minHeight: 340, borderRadius: 20,
          border: "2px solid " + sc.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 32, transition: "all 0.4s ease", boxSizing: "border-box",
          background: revealed ? sc.bg : "#0f0f23",
          cursor: revealed ? "default" : "pointer",
        }}
      >
        {!revealed ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 56 }}>{isDare ? "\uD83D\uDE08" : "\u2753"}</div>
            <div style={{ color: "#666", fontSize: 16 }}>{"Tap to reveal"}</div>
            <div style={{
              padding: "6px 16px", borderRadius: 99, fontSize: 13, fontWeight: 600,
              background: sc.bg, color: sc.text,
            }}>
              {sc.emoji + " " + sc.label + " " + (isDare ? "Dare" : "Truth")}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: sc.text }}>
              {(isDare ? "\uD83D\uDE08 DARE" : "\uD83D\uDCAC TRUTH") + " \u2014 " + sc.emoji + " " + sc.label}
            </div>
            <div style={{ fontSize: 21, lineHeight: 1.5, color: "#fff", fontWeight: 400 }}>{cur.text}</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, fontStyle: "italic", marginTop: 8 }}>
              {"...or drink \uD83E\uDD43"}
            </div>
          </div>
        )}
      </div>

      {revealed && (
        <button onClick={next} style={{
          marginTop: 24, padding: "14px 40px", fontSize: 17, fontWeight: 600,
          background: "#1a1a3e", color: "#e8a838", border: "2px solid #e8a838",
          borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
        }}>
          {idx < deck.length - 1 ? "Next Card >" : "Finish"}
        </button>
      )}
    </div>
  );
}

var S = {
  wrap: {
    minHeight: "100vh", background: "#0a0a1a", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", padding: 20,
    fontFamily: "Georgia, serif", color: "#e0e0e0",
  },
  setup: {
    background: "#12122a", borderRadius: 16, padding: "40px 32px",
    maxWidth: 480, width: "100%", border: "1px solid #2a2a4a",
  },
  title: { fontSize: 26, fontWeight: 700, textAlign: "center", margin: "0 0 8px", color: "#f0f0f0", lineHeight: 1.3 },
  or: { color: "#e8a838", fontStyle: "italic", fontWeight: 400 },
  sub: { textAlign: "center", color: "#888", fontSize: 14, fontStyle: "italic", marginBottom: 32 },
  sec: { marginBottom: 24 },
  secT: { fontSize: 13, textTransform: "uppercase", letterSpacing: 2, color: "#999", marginBottom: 12 },
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  lbl: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", color: "#ccc", fontSize: 15, cursor: "pointer" },
  cb: { width: 18, height: 18, accentColor: "#e8a838" },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: 480, marginBottom: 20 },
  back: { background: "none", border: "none", color: "#888", fontSize: 15, cursor: "pointer", fontFamily: "inherit" },
};
