/**
 * Unit conversion utilities for medical measurements
 */

/**
 * Convert Fahrenheit to Celsius
 */
export function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

/**
 * Convert Celsius to Fahrenheit
 */
export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

/**
 * Convert pounds to kilograms
 */
export function poundsToKilograms(lbs: number): number {
  return lbs * 0.453592;
}

/**
 * Convert kilograms to pounds
 */
export function kilogramsToPounds(kg: number): number {
  return kg / 0.453592;
}

/**
 * Convert centimeters to inches
 */
export function centimetersToInches(cm: number): number {
  return cm / 2.54;
}

/**
 * Convert inches to centimeters
 */
export function inchesToCentimeters(inches: number): number {
  return inches * 2.54;
}

/**
 * Convert centimeters to feet and inches
 */
export function centimetersToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = centimetersToInches(cm);
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return { feet, inches };
}

/**
 * Convert feet and inches to centimeters
 */
export function feetInchesToCentimeters(feet: number, inches: number): number {
  const totalInches = feet * 12 + inches;
  return inchesToCentimeters(totalInches);
}

/**
 * Format temperature with conversion
 */
export function formatTemperatureWithConversion(value: string, unit: "F" | "C" = "F"): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;

  if (unit === "F") {
    const celsius = fahrenheitToCelsius(num);
    return `${value}°F (${celsius.toFixed(1)}°C)`;
  } else {
    const fahrenheit = celsiusToFahrenheit(num);
    return `${value}°C (${fahrenheit.toFixed(1)}°F)`;
  }
}

/**
 * Format weight with conversion
 */
export function formatWeightWithConversion(value: string, unit: "lbs" | "kg" = "lbs"): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;

  if (unit === "lbs") {
    const kg = poundsToKilograms(num);
    return `${value} lbs (${kg.toFixed(1)} kg)`;
  } else {
    const lbs = kilogramsToPounds(num);
    return `${value} kg (${lbs.toFixed(1)} lbs)`;
  }
}

/**
 * Format height with conversion
 */
export function formatHeightWithConversion(value: string, unit: "cm" | "in" = "cm"): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;

  if (unit === "cm") {
    const inches = centimetersToInches(num);
    const feetInches = centimetersToFeetInches(num);
    if (feetInches.feet > 0) {
      return `${value} cm (${feetInches.feet}'${feetInches.inches}")`;
    }
    return `${value} cm (${inches.toFixed(1)} in)`;
  } else {
    const cm = inchesToCentimeters(num);
    return `${value} in (${cm.toFixed(1)} cm)`;
  }
}
