/* ============================================================
   NourishAI — app.js
   Smart Meal Planner — All JavaScript Logic
   ============================================================ */

"use strict";

/* ── CONFIG ────────────────────────────────────────────────
   HOW TO CONNECT AI:
   1. Get your API key from https://console.anthropic.com
   2. Replace YOUR_API_KEY_HERE below with your key
   3. For a live/group project, point API_URL to your teammates'
      Spring Boot backend instead of calling Claude directly:
      const API_URL = "http://localhost:8080/api/claude/generate";
   ──────────────────────────────────────────────────────── */
const API_KEY = "YOUR_API_KEY_HERE";
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL   = "claude-sonnet-4-20250514";

/* ── CONSTANTS ─────────────────────────────────────────────
   Mirror the options available in index.html dropdowns.
─────────────────────────────────────────────────────────── */
const DAYS  = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const MEAL_EMOJI = {
  Breakfast: "🌅",
  Lunch:     "☀️",
  Dinner:    "🌙",
  Snack:     "🍎"
};

/* ── APP STATE ─────────────────────────────────────────────
   Single source of truth for the whole app.
   All UI reads from and writes to this object.
─────────────────────────────────────────────────────────── */
let state = {
  diet:         "None",
  goal:         "Weight Loss",
  calories:     2000,
  mealPlan:     null,   // Holds the 7-day JSON once generated
  activeDay:    "Mon",  // Selected day on Meal Plan tab
  nutritionDay: "Mon",  // Selected day on Nutrition tab
};

/* ── DOM HELPER ─────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   Small pop-up messages for success / error feedback.
════════════════════════════════════════════════════════ */
let toastTimer;

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

/* ════════════════════════════════════════════════════════
   TAB SWITCHING
   Shows the correct panel and triggers any data refresh needed.
════════════════════════════════════════════════════════ */
function switchTab(tabId) {
  // Deactivate all tabs and panels
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));

  // Activate the selected tab and panel
  document.querySelector(`.tab[data-tab="${tabId}"]`).classList.add("active");
  $(`panel-${tabId}`).classList.add("active");

  // Refresh panels that depend on existing meal plan data
  if (tabId === "nutrition") refreshNutritionPanel();
  if (tabId === "grocery")   refreshGroceryPanel();
}

// Attach click handlers to all tab buttons
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

/* ════════════════════════════════════════════════════════
   PROFILE CONTROLS
   Keep state in sync with the dropdowns and calorie slider.
════════════════════════════════════════════════════════ */
$("sel-diet").addEventListener("change", e => {
  state.diet = e.target.value;
  $("tag-diet").textContent = state.diet === "None" ? "Any Diet" : state.diet;
  updateFooter();
});

$("sel-goal").addEventListener("change", e => {
  state.goal = e.target.value;
  $("tag-goal").textContent = state.goal;
  updateFooter();
});

$("calorie-slider").addEventListener("input", e => {
  state.calories = Number(e.target.value);
  $("calorie-display").textContent = state.calories + " kcal";
  updateFooter();
});

function updateFooter() {
  $("footer-status").textContent = `${state.calories} kcal · ${state.diet} · ${state.goal}`;
}

/* ════════════════════════════════════════════════════════
   CLAUDE API — CORE FUNCTION
   All AI calls go through here.
   Sends a prompt to Claude and returns the response text.
════════════════════════════════════════════════════════ */
async function callClaude(userPrompt, systemPrompt) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type":   "application/json",
      "x-api-key":      API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 1000,
      system:     systemPrompt || "You are a professional nutritionist and chef. Be concise and practical.",
      messages:   [{ role: "user", content: userPrompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.content?.map(block => block.text || "").join("") || "";
}

/* ════════════════════════════════════════════════════════
   TYPEWRITER EFFECT
   Animates AI text output character by character.
════════════════════════════════════════════════════════ */
function typewrite(element, text, speed = 16) {
  element.textContent = "";
  let index = 0;
  const tick = setInterval(() => {
    element.textContent = text.slice(0, ++index);
    if (index >= text.length) clearInterval(tick);
  }, speed);
}

/* ════════════════════════════════════════════════════════
   SPINNER & BUTTON HELPERS
   Show/hide loading spinners and toggle button states.
════════════════════════════════════════════════════════ */
function showSpinner(id)           { $(id).style.display = "flex"; }
function hideSpinner(id)           { $(id).style.display = "none"; }
function disableBtn(id)            { $(id).disabled = true; $(id).textContent = "Please wait…"; }
function enableBtn(id, label)      { $(id).disabled = false; $(id).textContent = label; }

/* ════════════════════════════════════════════════════════
   TAB 1 — MEAL PLAN GENERATOR
   Generates a full 7-day meal plan from Claude as JSON,
   then renders it with a day selector and meal cards.
════════════════════════════════════════════════════════ */
$("btn-generate-plan").addEventListener("click", generateMealPlan);

async function generateMealPlan() {
  disableBtn("btn-generate-plan");
  showSpinner("spinner-plan");
  $("plan-empty").style.display       = "none";
  $("meal-plan-output").style.display = "none";

  const prompt = `Create a 7-day meal plan for:
- Diet: ${state.diet}
- Goal: ${state.goal}
- Daily calories: ${state.calories}

Return ONLY a valid JSON object with NO markdown fences, NO explanation — just raw JSON:
{
  "Mon":{"Breakfast":"name","Lunch":"name","Dinner":"name","Snack":"name"},
  "Tue":{"Breakfast":"name","Lunch":"name","Dinner":"name","Snack":"name"},
  "Wed":{"Breakfast":"name","Lunch":"name","Dinner":"name","Snack":"name"},
  "Thu":{"Breakfast":"name","Lunch":"name","Dinner":"name","Snack":"name"},
  "Fri":{"Breakfast":"name","Lunch":"name","Dinner":"name","Snack":"name"},
  "Sat":{"Breakfast":"name","Lunch":"name","Dinner":"name","Snack":"name"},
  "Sun":{"Breakfast":"name","Lunch":"name","Dinner":"name","Snack":"name"}
}`;

  try {
    const raw   = await callClaude(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found in response");

    state.mealPlan = JSON.parse(match[0]);
    renderMealPlan();
    showToast("✅ Meal plan generated!");
  } catch (err) {
    showToast("❌ Error: " + err.message);
    $("plan-empty").style.display = "block";
  }

  hideSpinner("spinner-plan");
  enableBtn("btn-generate-plan", "✨ Generate Weekly Plan");
}

/* Renders the day-selector buttons and initial meal cards */
function renderMealPlan() {
  if (!state.mealPlan) return;

  const daySelector = $("day-selector");
  daySelector.innerHTML = "";

  DAYS.forEach(day => {
    const btn = document.createElement("button");
    btn.className   = "day-btn" + (day === state.activeDay ? " active" : "");
    btn.textContent = day;

    btn.addEventListener("click", () => {
      state.activeDay = day;
      document.querySelectorAll("#day-selector .day-btn")
        .forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderMealCards();
    });

    daySelector.appendChild(btn);
  });

  renderMealCards();
  $("meal-plan-output").style.display = "block";
}

/* Renders the 4 meal cards for the currently selected day */
function renderMealCards() {
  const list   = $("meal-list");
  const dayData = state.mealPlan[state.activeDay];
  list.innerHTML = "";
  if (!dayData) return;

  MEALS.forEach((meal, index) => {
    const card = document.createElement("div");
    card.className          = "meal-item";
    card.style.animationDelay = (index * 0.07) + "s";
    card.innerHTML = `
      <div class="meal-item-label">${MEAL_EMOJI[meal]} ${meal}</div>
      <div class="meal-item-name">${dayData[meal] || "—"}</div>
    `;
    list.appendChild(card);
  });
}

/* ════════════════════════════════════════════════════════
   TAB 2 — RECIPE GENERATOR
   Takes a list of ingredients the user has available
   and asks Claude to suggest a complete recipe.
════════════════════════════════════════════════════════ */
$("btn-generate-recipe").addEventListener("click", generateRecipe);

async function generateRecipe() {
  const ingredients = $("ingredients-input").value.trim();
  if (!ingredients) {
    showToast("⚠️ Please enter some ingredients first.");
    return;
  }

  disableBtn("btn-generate-recipe");
  showSpinner("spinner-recipe");
  $("recipe-output").style.display = "none";
  $("recipe-empty").style.display  = "none";

  const prompt = `I have these ingredients: ${ingredients}
Diet type: ${state.diet}
Health goal: ${state.goal}

Suggest ONE complete recipe with:
- Recipe name
- Full ingredients list with quantities
- Step-by-step cooking instructions
- Prep time & cook time
- Number of servings
- Brief nutrition summary (calories, protein, carbs, fat)

Keep it practical, delicious, and aligned with the diet type.`;

  try {
    const result = await callClaude(prompt);
    $("recipe-output").style.display = "block";
    typewrite($("recipe-text"), result);
    showToast("👨‍🍳 Recipe ready!");
  } catch (err) {
    showToast("❌ Error: " + err.message);
    $("recipe-empty").style.display = "block";
  }

  hideSpinner("spinner-recipe");
  enableBtn("btn-generate-recipe", "👨‍🍳 Generate Recipe");
}

/* ════════════════════════════════════════════════════════
   TAB 3 — NUTRITION ANALYSIS
   Analyses the calories and macros for a selected day
   from the generated meal plan.
════════════════════════════════════════════════════════ */

/* Called whenever the Nutrition tab becomes active */
function refreshNutritionPanel() {
  if (!state.mealPlan) {
    $("nutrition-needs-plan").style.display = "block";
    $("nutrition-ready").style.display      = "none";
  } else {
    $("nutrition-needs-plan").style.display = "none";
    $("nutrition-ready").style.display      = "block";
    buildNutritionDaySelector();
    renderNutritionMeals();
  }
}

function buildNutritionDaySelector() {
  const selector = $("nutrition-day-selector");
  selector.innerHTML = "";

  DAYS.forEach(day => {
    const btn = document.createElement("button");
    btn.className   = "day-btn" + (day === state.nutritionDay ? " active" : "");
    btn.textContent = day;

    btn.addEventListener("click", () => {
      state.nutritionDay = day;
      document.querySelectorAll("#nutrition-day-selector .day-btn")
        .forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      $("nutrition-day-label").textContent  = day;
      renderNutritionMeals();
      $("nutrition-output").style.display = "none"; // Hide previous result
    });

    selector.appendChild(btn);
  });
}

function renderNutritionMeals() {
  const list   = $("nutrition-meals-list");
  const dayData = state.mealPlan?.[state.nutritionDay];
  list.innerHTML = "";
  if (!dayData) return;

  MEALS.forEach(meal => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; gap:8px; align-items:center; margin-bottom:7px;";
    row.innerHTML = `
      <span style="font-size:14px;">${MEAL_EMOJI[meal]}</span>
      <span style="font-size:13px; color:var(--text-muted);">
        <strong style="font-size:9px; letter-spacing:1.5px; text-transform:uppercase; color:var(--text-dim);">
          ${meal}&nbsp;&nbsp;
        </strong>${dayData[meal]}
      </span>
    `;
    list.appendChild(row);
  });
}

$("btn-analyse").addEventListener("click", analyseNutrition);

async function analyseNutrition() {
  if (!state.mealPlan) {
    showToast("Generate a meal plan first!");
    return;
  }

  const dayData = state.mealPlan[state.nutritionDay];
  disableBtn("btn-analyse");
  showSpinner("spinner-nutrition");
  $("nutrition-output").style.display = "none";

  const prompt = `Analyse the full nutrition for this day's meals:
Breakfast: ${dayData.Breakfast}
Lunch:     ${dayData.Lunch}
Dinner:    ${dayData.Dinner}
Snack:     ${dayData.Snack}

Provide:
1. Estimated calories per meal
2. Total daily calories
3. Macronutrients (protein, carbs, fat in grams)
4. Key vitamins and minerals
5. 2–3 personalised health tips for goal: ${state.goal}

Be clear, specific, and practical.`;

  try {
    const result = await callClaude(prompt);
    $("nutrition-output").style.display = "block";
    typewrite($("nutrition-text"), result);
    showToast("📊 Analysis complete!");
  } catch (err) {
    showToast("❌ Error: " + err.message);
  }

  hideSpinner("spinner-nutrition");
  enableBtn("btn-analyse", "📊 Analyse Nutrition");
}

/* ════════════════════════════════════════════════════════
   TAB 4 — GROCERY LIST GENERATOR
   Builds a categorised shopping list from all 7 days
   of the generated meal plan.
════════════════════════════════════════════════════════ */

/* Called whenever the Grocery tab becomes active */
function refreshGroceryPanel() {
  if (!state.mealPlan) {
    $("grocery-needs-plan").style.display = "block";
    $("grocery-ready").style.display      = "none";
  } else {
    $("grocery-needs-plan").style.display = "none";
    $("grocery-ready").style.display      = "block";
    $("grocery-desc").textContent =
      `We'll build a complete, categorised grocery list from your entire week's meal plan` +
      (state.diet !== "None" ? ` — optimised for your ${state.diet} diet.` : ".");
  }
}

$("btn-grocery").addEventListener("click", generateGrocery);

async function generateGrocery() {
  if (!state.mealPlan) return;

  disableBtn("btn-grocery");
  showSpinner("spinner-grocery");
  $("grocery-output").style.display = "none";

  // Flatten all meals from every day into a single list
  const allMeals = DAYS
    .flatMap(day => MEALS.map(meal => state.mealPlan[day]?.[meal]))
    .filter(Boolean)
    .join(", ");

  const prompt = `Generate a complete, organised grocery list for a week of meals including: ${allMeals}

Diet restriction: ${state.diet}

Organise by these categories:
- 🥦 Produce (fruits & vegetables)
- 🍗 Proteins (meat, fish, eggs, legumes)
- 🥛 Dairy / Alternatives
- 🌾 Grains & Bread
- 🫙 Pantry & Condiments
- 🧊 Frozen Items (if any)

Include estimated quantities for each item. Be practical and minimise waste.`;

  try {
    const result = await callClaude(prompt);
    $("grocery-output").style.display = "block";
    typewrite($("grocery-text"), result);
    showToast("🛒 Grocery list ready!");
  } catch (err) {
    showToast("❌ Error: " + err.message);
  }

  hideSpinner("spinner-grocery");
  enableBtn("btn-grocery", "🛒 Generate Grocery List");
}

/* Copy grocery list to clipboard */
$("btn-copy-grocery").addEventListener("click", () => {
  const text = $("grocery-text").textContent;
  if (!text) return;
  navigator.clipboard.writeText(text)
    .then(() => showToast("📋 Copied to clipboard!"));
});

/* ════════════════════════════════════════════════════════
   INITIALISE
   Run on page load to set the footer to default values.
════════════════════════════════════════════════════════ */
updateFooter();
