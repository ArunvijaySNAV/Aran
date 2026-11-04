// Shared demo-data pools. Everything here is meant to belong to nobody.
// Cards: published payment-gateway test numbers (Luhn-valid, 16 digits, an issuer prefix Aran recognises). Filtered through the bank's own validator at load.
// Names: first names are common, surnames are obviously fictional. No customer email is generated anywhere; staff use the reserved ".test" domain.
import { isCard } from "../bank/lib/validators";

export const TEST_CARDS = [
  "4111111111111111", "4242424242424242", "4012888888881881", "4000056655665556", "5555555555554444", "5105105105105100",
  "2223003122003222", "5200828282828210", "6011111111111117", "6011000990139424", "3530111333300000", "3566002020360505",
  "4000000000000002", "4000000000000077", "5555444433331111", "5425233430109903",
].filter(isCard);

export const FIRST = ["Aarav", "Priya", "Vikram", "Ananya", "Rajesh", "Meera", "Rohan", "Sunita", "Kavita", "Siddharth", "Deepa", "Karthik", "Divya", "Manoj", "Lakshmi"];
export const LAST = ["Testwala", "Sampleton", "Demokar", "Mockerjee", "Fictionwal", "Specimen", "Placeholdi", "Exampleraj", "Dummyani", "Samplekar", "Testrao", "Demonair", "Fakeswamy", "Mockpillai", "Trialwala"];
